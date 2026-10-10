-- PREPARED ONLY. Immutable input transport across hosts, not renderer/isolation attestation.
BEGIN;
CREATE TABLE private.hyperframes_conformance_render_reservations (
  job_id uuid PRIMARY KEY REFERENCES private.hyperframes_conformance_jobs(id) ON DELETE RESTRICT,
  execution_id uuid NOT NULL REFERENCES private.composition_render_executions(id) ON DELETE RESTRICT,
  reservation_text text NOT NULL CHECK (octet_length(reservation_text) BETWEEN 1 AND 20971520),
  reservation_sha256 text NOT NULL CHECK (reservation_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (encode(sha256(convert_to(reservation_text, 'UTF8')), 'hex') = reservation_sha256)
);
ALTER TABLE private.hyperframes_conformance_render_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_conformance_render_reservations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.register_hyperframes_conformance_render_reservation(
  p_job_id uuid, p_organization_id uuid, p_request_id uuid, p_revision_id uuid,
  p_reservation_text text, p_reservation_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  v_job private.hyperframes_conformance_jobs%ROWTYPE;
  v_execution private.composition_render_executions%ROWTYPE;
  v_existing private.hyperframes_conformance_render_reservations%ROWTYPE;
  v_reservation jsonb;
  v_selection jsonb;
  v_recovered jsonb;
BEGIN
  IF p_reservation_text IS NULL OR octet_length(p_reservation_text) NOT BETWEEN 1 AND 20971520
    OR p_reservation_sha256 IS NULL OR p_reservation_sha256 !~ '^[a-f0-9]{64}$'
    OR encode(sha256(convert_to(p_reservation_text, 'UTF8')), 'hex') IS DISTINCT FROM p_reservation_sha256 THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_INTEGRITY_INVALID';
  END IF;
  v_reservation := p_reservation_text::jsonb;
  IF jsonb_typeof(v_reservation) IS DISTINCT FROM 'object'
    OR v_reservation->'version' IS DISTINCT FROM '1'::jsonb
    OR v_reservation->>'policy' IS DISTINCT FROM 'EXACT_JOB_RENDER_RESERVATION_V1'
    OR v_reservation->>'jobId' IS DISTINCT FROM p_job_id::text
    OR (v_reservation - ARRAY['version','policy','jobId','scope','binding','supervisorReceiptSha256','artifacts','referenceSelection']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_INVALID';
  END IF;
  SELECT * INTO v_job FROM private.hyperframes_conformance_jobs
    WHERE id = p_job_id AND organization_id = p_organization_id AND request_id = p_request_id
      AND revision_id = p_revision_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_SCOPE_MISMATCH'; END IF;
  SELECT * INTO v_execution FROM private.composition_render_executions
    WHERE id = (v_reservation#>>'{scope,executionId}')::uuid AND status = 'CONSUMED'
      AND organization_id = v_job.organization_id AND request_id = v_job.request_id
      AND revision_id = v_job.revision_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_AUTHORITY_INVALID'; END IF;
  v_recovered := public.read_consumed_composition_render_execution(v_execution.organization_id,
    v_execution.request_id, v_execution.id, v_execution.revision_id, v_execution.production_job_id);
  IF v_recovered IS NULL OR v_recovered#>>'{context,key,revoked}' IS DISTINCT FROM 'false'
    OR v_reservation->'scope' IS DISTINCT FROM jsonb_build_object('organizationId', v_job.organization_id::text,
      'requestId', v_job.request_id::text, 'revisionId', v_job.revision_id::text,
      'executionId', v_execution.id::text, 'productionJobId', v_execution.production_job_id::text)
    OR v_reservation->'binding' IS DISTINCT FROM v_execution.receipt#>'{payload,binding}'
    OR v_reservation->>'supervisorReceiptSha256' IS DISTINCT FROM v_execution.receipt_sha256
    OR v_reservation#>>'{artifacts,kind}' IS DISTINCT FROM v_execution.artifact_kind THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_BINDING_INVALID';
  END IF;
  IF (CASE WHEN v_execution.artifact_kind = 'SINGLE_CONTRACT'
    THEN v_reservation#>'{artifacts,input,contract}' ELSE v_reservation#>'{artifacts,input,parentContract}' END)
    IS DISTINCT FROM v_execution.contract THEN RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_CONTRACT_INVALID'; END IF;
  v_selection := v_reservation->'referenceSelection';
  IF v_selection->>'scope' IS DISTINCT FROM 'HOST_AUTHORIZED_EXACT_REFERENCE_SELECTION_NOT_DURABLE_ATTESTATION'
    OR v_selection->>'organizationId' IS DISTINCT FROM v_job.organization_id::text
    OR v_selection->>'revisionId' IS DISTINCT FROM v_job.revision_id::text
    OR v_selection->>'executionId' IS DISTINCT FROM v_execution.id::text
    OR v_selection->>'documentHash' IS DISTINCT FROM v_execution.document_hash
    OR v_selection->>'projectHash' IS DISTINCT FROM v_execution.project_hash
    OR v_selection->>'contractSha256' IS DISTINCT FROM v_execution.contract_sha256
    OR jsonb_typeof(v_selection->'references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_REFERENCES_INVALID';
  END IF;
  IF jsonb_array_length(v_selection->'references') IS DISTINCT FROM
      coalesce((v_execution.contract#>>'{checkpointBatch,batchCount}')::integer, 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_selection->'references') WITH ORDINALITY AS selected(value, ordinal_index)
      WHERE jsonb_typeof(selected.value) IS DISTINCT FROM 'object'
        OR selected.value->'batchIndex' IS DISTINCT FROM to_jsonb(selected.ordinal_index - 1)
        OR coalesce(selected.value->>'visualChecksum', '') !~ '^[a-f0-9]{64}$'
        OR CASE WHEN v_execution.contract#>'{audio,required}' = 'true'::jsonb
          THEN coalesce(selected.value->>'audioChecksum', '') !~ '^[a-f0-9]{64}$'
          ELSE selected.value ? 'audioChecksum' END) THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_REFERENCE_COVERAGE_INVALID';
  END IF;
  INSERT INTO private.hyperframes_conformance_render_reservations(job_id, execution_id, reservation_text, reservation_sha256)
    VALUES (v_job.id, v_execution.id, p_reservation_text, p_reservation_sha256) ON CONFLICT (job_id) DO NOTHING;
  SELECT * INTO v_existing FROM private.hyperframes_conformance_render_reservations WHERE job_id = v_job.id FOR SHARE;
  IF v_existing.execution_id IS DISTINCT FROM v_execution.id
    OR v_existing.reservation_sha256 IS DISTINCT FROM p_reservation_sha256
    OR v_existing.reservation_text IS DISTINCT FROM p_reservation_text THEN
    RAISE EXCEPTION 'CONFORMANCE_JOB_RESERVATION_CONFLICT';
  END IF;
  RETURN v_existing.reservation_sha256;
END;
$$;
REVOKE ALL ON FUNCTION public.register_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.read_hyperframes_conformance_render_reservation(
  p_job_id uuid, p_lease_token uuid, p_organization_id uuid, p_request_id uuid, p_revision_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT jsonb_build_object('reservationText', reservation.reservation_text, 'sha256', reservation.reservation_sha256)
  FROM private.hyperframes_conformance_render_reservations reservation
  JOIN private.hyperframes_conformance_jobs job ON job.id = reservation.job_id
  JOIN private.composition_render_executions execution ON execution.id = reservation.execution_id
  WHERE job.id = p_job_id AND job.organization_id = p_organization_id AND job.request_id = p_request_id
    AND job.revision_id = p_revision_id AND job.status = 'RUNNING' AND job.lease_token = p_lease_token
    AND job.lease_expires_at > now() AND job.attempt_started_at + interval '2 hours' > now()
    AND execution.status = 'CONSUMED' AND execution.organization_id = job.organization_id
    AND execution.request_id = job.request_id AND execution.revision_id = job.revision_id;
$$;
REVOKE ALL ON FUNCTION public.read_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_conformance_render_reservation(uuid,uuid,uuid,uuid,uuid) TO service_role;

-- Bind the final report to the immutable reservation; a reserved job cannot downgrade to legacy.
ALTER FUNCTION public.finish_hyperframes_conformance_job(uuid,uuid,jsonb,text,boolean) SET SCHEMA private;
ALTER FUNCTION private.finish_hyperframes_conformance_job(uuid,uuid,jsonb,text,boolean)
  RENAME TO finish_hyperframes_conformance_job_before_reservation;
REVOKE ALL ON FUNCTION private.finish_hyperframes_conformance_job_before_reservation(uuid,uuid,jsonb,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.finish_hyperframes_conformance_job(
  p_job_id uuid, p_lease_token uuid, p_report jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_retryable boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  v_job private.hyperframes_conformance_jobs%ROWTYPE;
  v_reserved private.hyperframes_conformance_render_reservations%ROWTYPE;
  v_manifest jsonb;
BEGIN
  SELECT * INTO v_job FROM private.hyperframes_conformance_jobs WHERE id = p_job_id
    AND lease_token = p_lease_token AND status = 'RUNNING' AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_report IS NOT NULL THEN
    SELECT * INTO v_reserved FROM private.hyperframes_conformance_render_reservations WHERE job_id = v_job.id FOR SHARE;
    IF FOUND THEN
      v_manifest := v_reserved.reservation_text::jsonb;
      IF p_report->'reservationEvidence' IS DISTINCT FROM jsonb_build_object(
        'policy', 'EXACT_JOB_RENDER_RESERVATION_V1', 'sha256', v_reserved.reservation_sha256,
        'executionId', v_reserved.execution_id::text, 'supervisorReceiptSha256', v_manifest->>'supervisorReceiptSha256')
        OR p_report->'referenceSelection' IS DISTINCT FROM v_manifest->'referenceSelection'
        OR p_report#>'{renderEvidence,binding}' IS DISTINCT FROM v_manifest->'binding'
        OR p_report#>>'{renderEvidence,supervisorReceiptSha256}' IS DISTINCT FROM v_manifest->>'supervisorReceiptSha256' THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_DURABLE_RESERVATION_BINDING_INVALID';
      END IF;
    ELSIF p_report ? 'reservationEvidence' THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_DURABLE_RESERVATION_MISSING';
    END IF;
  END IF;
  -- All previous attempt, controlled-render, event, visual/audio and remote-integrity gates remain.
  RETURN private.finish_hyperframes_conformance_job_before_reservation(
    p_job_id, p_lease_token, p_report, p_error_code, p_retryable);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_hyperframes_conformance_job(uuid,uuid,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_conformance_job(uuid,uuid,jsonb,text,boolean) TO service_role;
COMMIT;
-- Rollback: stop reserved-host consumers and revoke these two RPCs. Preserve the private records,
-- consumed authority, reports and evidence. Do not cascade-delete records or reset process fences.
-- Restore the previous public finisher from the retained private before_reservation wrapper
-- with its original service-role grant; keep the rest of the gate chain unchanged.
