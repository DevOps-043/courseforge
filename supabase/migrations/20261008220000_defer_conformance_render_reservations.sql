-- PREPARED ONLY. Exact consumed input handoff; no backfill, flags, deployment or QA approval.
BEGIN;
CREATE TABLE private.hyperframes_conformance_render_outbox (
  request_id uuid PRIMARY KEY REFERENCES public.hyperframes_render_requests(id) ON DELETE RESTRICT,
  execution_id uuid NOT NULL REFERENCES private.composition_render_executions(id) ON DELETE RESTRICT,
  reservation_text text NOT NULL CHECK (octet_length(reservation_text) BETWEEN 1 AND 20971520),
  reservation_sha256 text NOT NULL CHECK (reservation_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (encode(sha256(convert_to(reservation_text, 'UTF8')), 'hex') = reservation_sha256)
);
ALTER TABLE private.hyperframes_conformance_render_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_conformance_render_outbox FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.attach_hyperframes_conformance_render_outbox(p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  v_job private.hyperframes_conformance_jobs%ROWTYPE;
  v_outbox private.hyperframes_conformance_render_outbox%ROWTYPE;
  v_reservation jsonb;
  v_text text;
BEGIN
  SELECT * INTO STRICT v_job FROM private.hyperframes_conformance_jobs WHERE id = p_job_id FOR SHARE;
  SELECT * INTO v_outbox FROM private.hyperframes_conformance_render_outbox WHERE request_id = v_job.request_id FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF; -- Legacy jobs without an opted-in outbox retain their existing route.
  v_reservation := (v_outbox.reservation_text::jsonb - 'policy') ||
    jsonb_build_object('policy', 'EXACT_JOB_RENDER_RESERVATION_V1', 'jobId', v_job.id::text);
  v_text := v_reservation::text;
  -- Reuse consumed ledger/revocation/full-contract/reference checks and immutable job CAS.
  PERFORM public.register_hyperframes_conformance_render_reservation(v_job.id, v_job.organization_id,
    v_job.request_id, v_job.revision_id, v_text, encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
END;
$$;
REVOKE ALL ON FUNCTION private.attach_hyperframes_conformance_render_outbox(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.stage_hyperframes_conformance_render_reservation(
  p_organization_id uuid, p_request_id uuid, p_revision_id uuid, p_execution_id uuid,
  p_reservation_text text, p_reservation_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  v_execution private.composition_render_executions%ROWTYPE;
  v_existing private.hyperframes_conformance_render_outbox%ROWTYPE;
  v_reservation jsonb;
  v_selection jsonb;
  v_recovered jsonb;
  v_job_id uuid;
  v_job_payload_bytes integer;
BEGIN
  IF p_reservation_text IS NULL OR octet_length(p_reservation_text) NOT BETWEEN 1 AND 20971520
    OR p_reservation_sha256 IS NULL OR p_reservation_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_reservation_text, 'UTF8')), 'hex') IS DISTINCT FROM p_reservation_sha256 THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_INTEGRITY_INVALID';
  END IF;
  v_reservation := p_reservation_text::jsonb;
  IF jsonb_typeof(v_reservation) IS DISTINCT FROM 'object'
    OR v_reservation->'version' IS DISTINCT FROM '1'::jsonb
    OR v_reservation->>'policy' IS DISTINCT FROM 'EXACT_RENDER_RESERVATION_OUTBOX_V1'
    OR (v_reservation - ARRAY['version','policy','scope','binding','supervisorReceiptSha256','artifacts','referenceSelection']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_INVALID';
  END IF;
  -- Bound the future jsonb::text serialization too (spacing/numeric expansion can exceed input bytes).
  -- UUID text is always 36 bytes. This sizes the jobId field without inventing or publishing an ID.
  v_job_payload_bytes := octet_length(((v_reservation - 'policy') ||
    jsonb_build_object('policy', 'EXACT_JOB_RENDER_RESERVATION_V1'))::text) + octet_length(', "jobId": ""') + 36;
  IF v_job_payload_bytes > 20971520 THEN RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_LIMIT_EXCEEDED'; END IF;
  -- Common serialization point with the job insertion trigger; no polling/latest selection.
  PERFORM 1 FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id
    AND composition_revision_id = p_revision_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_SCOPE_MISMATCH'; END IF;
  SELECT * INTO v_execution FROM private.composition_render_executions WHERE id = p_execution_id AND status = 'CONSUMED'
    AND organization_id = p_organization_id AND request_id = p_request_id AND revision_id = p_revision_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_AUTHORITY_INVALID'; END IF;
  v_recovered := public.read_consumed_composition_render_execution(p_organization_id, p_request_id, p_execution_id,
    p_revision_id, v_execution.production_job_id);
  IF v_recovered IS NULL OR v_recovered#>>'{context,key,revoked}' IS DISTINCT FROM 'false'
    OR v_reservation->'scope' IS DISTINCT FROM jsonb_build_object('organizationId', p_organization_id::text,
      'requestId', p_request_id::text, 'revisionId', p_revision_id::text, 'executionId', p_execution_id::text,
      'productionJobId', v_execution.production_job_id::text)
    OR v_reservation->'binding' IS DISTINCT FROM v_execution.receipt#>'{payload,binding}'
    OR v_reservation->>'supervisorReceiptSha256' IS DISTINCT FROM v_execution.receipt_sha256
    OR v_reservation#>>'{artifacts,kind}' IS DISTINCT FROM v_execution.artifact_kind THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_BINDING_INVALID';
  END IF;
  IF (CASE WHEN v_execution.artifact_kind = 'SINGLE_CONTRACT' THEN v_reservation#>'{artifacts,input,contract}'
    ELSE v_reservation#>'{artifacts,input,parentContract}' END) IS DISTINCT FROM v_execution.contract THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_CONTRACT_INVALID';
  END IF;
  v_selection := v_reservation->'referenceSelection';
  IF v_selection->>'scope' IS DISTINCT FROM 'HOST_AUTHORIZED_EXACT_REFERENCE_SELECTION_NOT_DURABLE_ATTESTATION'
    OR v_selection->>'organizationId' IS DISTINCT FROM p_organization_id::text
    OR v_selection->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR v_selection->>'executionId' IS DISTINCT FROM p_execution_id::text
    OR v_selection->>'documentHash' IS DISTINCT FROM v_execution.document_hash
    OR v_selection->>'projectHash' IS DISTINCT FROM v_execution.project_hash
    OR v_selection->>'contractSha256' IS DISTINCT FROM v_execution.contract_sha256
    OR jsonb_typeof(v_selection->'references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_REFERENCES_INVALID';
  END IF;
  IF jsonb_array_length(v_selection->'references') IS DISTINCT FROM coalesce((v_execution.contract#>>'{checkpointBatch,batchCount}')::integer, 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_selection->'references') WITH ORDINALITY AS selected(value, ordinal_index)
      WHERE jsonb_typeof(selected.value) IS DISTINCT FROM 'object'
        OR selected.value->'batchIndex' IS DISTINCT FROM to_jsonb(selected.ordinal_index - 1)
        OR coalesce(selected.value->>'visualChecksum', '') !~ '^[a-f0-9]{64}$'
        OR CASE WHEN v_execution.contract#>'{audio,required}' = 'true'::jsonb
          THEN coalesce(selected.value->>'audioChecksum', '') !~ '^[a-f0-9]{64}$'
          ELSE selected.value ? 'audioChecksum' END) THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_REFERENCE_COVERAGE_INVALID';
  END IF;
  INSERT INTO private.hyperframes_conformance_render_outbox(request_id, execution_id, reservation_text, reservation_sha256)
    VALUES (p_request_id, p_execution_id, p_reservation_text, p_reservation_sha256) ON CONFLICT (request_id) DO NOTHING;
  SELECT * INTO STRICT v_existing FROM private.hyperframes_conformance_render_outbox WHERE request_id = p_request_id FOR SHARE;
  IF v_existing.execution_id IS DISTINCT FROM p_execution_id OR v_existing.reservation_text IS DISTINCT FROM p_reservation_text
    OR v_existing.reservation_sha256 IS DISTINCT FROM p_reservation_sha256 THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_CONFLICT';
  END IF;
  SELECT id INTO v_job_id FROM private.hyperframes_conformance_jobs WHERE request_id = p_request_id;
  IF v_job_id IS NOT NULL THEN PERFORM private.attach_hyperframes_conformance_render_outbox(v_job_id); END IF;
  RETURN v_existing.reservation_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.stage_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION private.attach_conformance_outbox_after_job_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  PERFORM 1 FROM public.hyperframes_render_requests WHERE id = NEW.request_id FOR NO KEY UPDATE;
  PERFORM private.attach_hyperframes_conformance_render_outbox(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.attach_conformance_outbox_after_job_insert() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER attach_conformance_outbox_after_job_insert AFTER INSERT ON private.hyperframes_conformance_jobs
  FOR EACH ROW EXECUTE FUNCTION private.attach_conformance_outbox_after_job_insert();
COMMIT;
