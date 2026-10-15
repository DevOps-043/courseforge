-- PREPARED ONLY. No enqueue trigger, worker activation, backend switch or migration application.
BEGIN;
CREATE TABLE private.controlled_render_worker_jobs (
  request_id uuid PRIMARY KEY REFERENCES public.hyperframes_render_requests(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supervisor_id text NOT NULL CHECK (supervisor_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  key_id text NOT NULL CHECK (key_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  issuance_id uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id text CHECK (worker_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','COMPLETED','FAILED','RECOVERY_REQUIRED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  lease_token uuid, lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  error_code text CHECK (error_code ~ '^[A-Z_]{1,100}$'),
  CHECK ((status = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL)
    OR (status <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL))
);
ALTER TABLE private.controlled_render_worker_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.controlled_render_worker_jobs FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX controlled_render_worker_due ON private.controlled_render_worker_jobs(available_at,request_id)
  WHERE status IN ('PENDING','RUNNING','RETRY_WAIT');

CREATE FUNCTION public.enqueue_controlled_render_worker_job(p_organization_id uuid,p_request_id uuid,p_supervisor_id text,p_key_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE r public.hyperframes_render_requests%ROWTYPE; q private.controlled_render_worker_jobs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.cancelled_at IS NOT NULL OR r.provider_render_id IS NOT NULL OR r.provider_status <> 'PENDING' THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_REQUEST_INVALID';
  END IF;
  PERFORM 1 FROM public.production_jobs j JOIN public.video_composition_revisions v ON v.id = r.composition_revision_id
    WHERE j.id = r.production_job_id AND j.organization_id = p_organization_id AND v.organization_id = p_organization_id
      AND j.status IN ('PENDING','QUEUED','RUNNING') AND j.input_snapshot->>'render_backend' = 'CONTROLLED'
      AND j.input_snapshot->>'revision_id' = v.id::text AND j.input_snapshot->>'project_hash' = v.project_hash
      AND v.manifest#>>'{conformance_contract,schemaVersion}' = '4'
      AND v.manifest#>>'{conformance_contract,renderExecution,backend}' = 'CONTROLLED'
      AND v.manifest->>'draft_document_hash' = v.manifest#>>'{conformance_contract,documentHash}' FOR SHARE OF j,v;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_LINEAGE_INVALID'; END IF;
  PERFORM 1 FROM private.composition_render_supervisor_keys k WHERE k.organization_id = p_organization_id
    AND k.supervisor_id = p_supervisor_id AND k.key_id = p_key_id AND NOT k.revoked
    AND k.not_before_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
    AND k.not_after_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_ISSUER_INVALID'; END IF;
  SELECT * INTO q FROM private.controlled_render_worker_jobs WHERE request_id = r.id FOR UPDATE;
  IF FOUND THEN
    IF q.organization_id <> p_organization_id OR q.supervisor_id <> p_supervisor_id OR q.key_id <> p_key_id THEN
      RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_ENQUEUE_CONFLICT';
    END IF;
    RETURN false;
  END IF;
  INSERT INTO private.controlled_render_worker_jobs(request_id,organization_id,supervisor_id,key_id)
    VALUES(r.id,p_organization_id,p_supervisor_id,p_key_id);
  RETURN true;
END $$;

CREATE FUNCTION public.claim_controlled_render_worker_job(p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE r public.hyperframes_render_requests%ROWTYPE; q private.controlled_render_worker_jobs%ROWTYPE;
  j public.production_jobs%ROWTYPE; v public.video_composition_revisions%ROWTYPE; execution_id uuid;
BEGIN
  IF p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_ID_INVALID'; END IF;
  -- Request-first lock order matches authority/finalization/fences; other workers skip locked requests.
  SELECT r1.* INTO r FROM public.hyperframes_render_requests r1 JOIN private.controlled_render_worker_jobs q1 ON q1.request_id = r1.id
    WHERE q1.status IN ('PENDING','RETRY_WAIT','RUNNING') AND q1.available_at <= clock_timestamp()
      AND (q1.worker_id IS NULL OR q1.worker_id = p_worker_id)
      AND (q1.status <> 'RUNNING' OR q1.lease_expires_at <= clock_timestamp())
    ORDER BY q1.available_at,q1.request_id LIMIT 1 FOR UPDATE OF r1 SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO q FROM private.controlled_render_worker_jobs WHERE request_id = r.id FOR UPDATE;
  SELECT * INTO j FROM public.production_jobs WHERE id = r.production_job_id AND organization_id = q.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_LINEAGE_INVALID'; END IF;
  IF r.cancelled_at IS NOT NULL OR r.provider_render_id IS NOT NULL OR r.organization_id <> q.organization_id
    OR j.input_snapshot->>'render_backend' IS DISTINCT FROM 'CONTROLLED' THEN
    UPDATE private.controlled_render_worker_jobs SET status = 'FAILED',error_code = 'CONTROLLED_RENDER_WORKER_REQUEST_INVALID',
      lease_token = NULL,lease_expires_at = NULL,updated_at = clock_timestamp() WHERE request_id = r.id;
    RETURN NULL;
  END IF;
  IF r.import_status = 'COMPLETED' AND r.provider_status = 'COMPLETED' AND j.status = 'SUCCEEDED' THEN
    PERFORM 1 FROM public.production_assets a JOIN private.composition_render_executions e ON e.production_job_id = j.id
      JOIN private.composition_render_supervisor_keys k ON k.organization_id = e.organization_id
        AND k.supervisor_id = e.supervisor_id AND k.key_id = e.key_id
      WHERE a.production_job_id = j.id AND a.organization_id = q.organization_id
        AND e.organization_id = q.organization_id AND e.request_id = r.id AND e.status = 'CONSUMED' AND NOT k.revoked
        AND a.metadata->>'render_backend' = 'CONTROLLED' AND a.metadata->>'render_request_id' = r.id::text
        AND a.metadata->>'render_execution_id' = e.id::text AND a.metadata->>'supervisor_receipt_sha256' = e.receipt_sha256
        AND j.output_snapshot->>'render_execution_id' = e.id::text AND j.output_snapshot#>>'{final_video,asset_id}' = a.id::text
        AND a.checksum = e.receipt#>>'{payload,binding,videoSha256}' FOR SHARE OF a,e,k;
    IF NOT FOUND THEN
      UPDATE private.controlled_render_worker_jobs SET status = 'RECOVERY_REQUIRED',error_code = 'CONTROLLED_RENDER_WORKER_LINEAGE_INVALID',
        lease_token = NULL,lease_expires_at = NULL,updated_at = clock_timestamp() WHERE request_id = r.id;
      RETURN NULL;
    END IF;
    UPDATE private.controlled_render_worker_jobs SET status = 'COMPLETED',error_code = NULL,
      lease_token = NULL,lease_expires_at = NULL,updated_at = clock_timestamp() WHERE request_id = r.id;
    RETURN NULL; -- Finalization ACK/queue-finish may have been lost: never render a completed job again.
  END IF;
  SELECT * INTO v FROM public.video_composition_revisions WHERE id = r.composition_revision_id AND organization_id = q.organization_id FOR SHARE;
  IF NOT FOUND OR j.status NOT IN ('PENDING','QUEUED','RUNNING') OR r.provider_status NOT IN ('PENDING','RUNNING')
    OR j.input_snapshot->>'revision_id' IS DISTINCT FROM v.id::text OR j.input_snapshot->>'project_hash' IS DISTINCT FROM v.project_hash
    OR v.manifest#>>'{conformance_contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR v.manifest#>>'{conformance_contract,schemaVersion}' IS DISTINCT FROM '4'
    OR v.manifest->>'draft_document_hash' IS DISTINCT FROM v.manifest#>>'{conformance_contract,documentHash}' THEN
    UPDATE private.controlled_render_worker_jobs SET status = 'RECOVERY_REQUIRED',error_code = 'CONTROLLED_RENDER_WORKER_LINEAGE_INVALID',
      lease_token = NULL,lease_expires_at = NULL,updated_at = clock_timestamp() WHERE request_id = r.id;
    RETURN NULL;
  END IF;
  IF q.attempts >= 5 THEN
    UPDATE private.controlled_render_worker_jobs SET status = 'RECOVERY_REQUIRED',error_code = 'CONTROLLED_RENDER_WORKER_ATTEMPTS_EXHAUSTED',
      lease_token = NULL,lease_expires_at = NULL,updated_at = clock_timestamp() WHERE request_id = r.id;
    RETURN NULL;
  END IF;
  SELECT id INTO execution_id FROM private.composition_render_executions WHERE request_id = r.id AND organization_id = q.organization_id
    ORDER BY attempt DESC LIMIT 1;
  UPDATE private.controlled_render_worker_jobs SET status = 'RUNNING',worker_id = p_worker_id,attempts = attempts + 1,
    lease_token = gen_random_uuid(),lease_expires_at = clock_timestamp() + interval '120 seconds',updated_at = clock_timestamp()
    WHERE request_id = r.id RETURNING * INTO q;
  RETURN jsonb_build_object('organizationId',q.organization_id,'requestId',r.id,'revisionId',v.id,'productionJobId',j.id,
    'workerId',q.worker_id,'leaseToken',q.lease_token,'issuanceId',q.issuance_id,'attempt',q.attempts,
    'supervisorId',q.supervisor_id,'keyId',q.key_id,'action',CASE WHEN execution_id IS NULL THEN 'EXECUTE' ELSE 'RESUME' END,
    'executionId',execution_id,'contract',v.manifest->'conformance_contract');
END $$;

CREATE FUNCTION public.renew_controlled_render_worker_job(p_organization_id uuid,p_request_id uuid,p_worker_id text,p_worker_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  PERFORM 1 FROM public.hyperframes_render_requests r JOIN public.production_jobs j ON j.id = r.production_job_id
    WHERE r.id = p_request_id AND r.organization_id = p_organization_id AND j.organization_id = p_organization_id
      AND r.cancelled_at IS NULL AND r.provider_render_id IS NULL AND r.provider_status IN ('PENDING','RUNNING','COMPLETED')
      AND j.status IN ('PENDING','QUEUED','RUNNING','SUCCEEDED')
      AND j.input_snapshot->>'render_backend' = 'CONTROLLED' FOR SHARE OF r;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE private.controlled_render_worker_jobs SET lease_expires_at = clock_timestamp() + interval '120 seconds',updated_at = clock_timestamp()
    WHERE request_id = p_request_id AND organization_id = p_organization_id AND worker_id = p_worker_id
      AND status = 'RUNNING' AND lease_token = p_worker_lease_token AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END $$;

CREATE FUNCTION public.finish_controlled_render_worker_job(p_organization_id uuid,p_request_id uuid,p_worker_id text,p_worker_lease_token uuid,
  p_asset_id uuid,p_error_code text,p_retryable boolean,p_recovery_required boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE r public.hyperframes_render_requests%ROWTYPE; q private.controlled_render_worker_jobs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND OR r.cancelled_at IS NOT NULL OR r.provider_render_id IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO q FROM private.controlled_render_worker_jobs WHERE request_id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR q.status <> 'RUNNING' OR q.worker_id IS DISTINCT FROM p_worker_id
    OR q.lease_token IS DISTINCT FROM p_worker_lease_token OR q.lease_expires_at <= clock_timestamp() THEN RETURN false; END IF;
  IF p_asset_id IS NOT NULL THEN
    IF p_error_code IS NOT NULL OR r.import_status <> 'COMPLETED' OR r.provider_status <> 'COMPLETED' THEN RETURN false; END IF;
    PERFORM 1 FROM public.production_jobs j JOIN public.production_assets a ON a.id = p_asset_id
      WHERE j.id = r.production_job_id AND j.organization_id = p_organization_id AND j.status = 'SUCCEEDED'
        AND j.input_snapshot->>'render_backend' = 'CONTROLLED' AND a.asset_type = 'FINAL_VIDEO'
        AND a.organization_id = p_organization_id AND a.production_job_id = j.id
        AND a.metadata->>'render_backend' = 'CONTROLLED' AND a.metadata->>'render_request_id' = r.id::text
        AND j.output_snapshot#>>'{final_video,asset_id}' = a.id::text FOR SHARE OF j,a;
    IF NOT FOUND THEN RETURN false; END IF;
  ELSIF p_error_code IS NULL OR p_error_code !~ '^[A-Z_]{1,100}$' THEN RETURN false;
  END IF;
  UPDATE private.controlled_render_worker_jobs SET status = CASE WHEN p_asset_id IS NOT NULL THEN 'COMPLETED'
      WHEN p_recovery_required OR q.attempts >= 5 THEN 'RECOVERY_REQUIRED' WHEN p_retryable THEN 'RETRY_WAIT' ELSE 'FAILED' END,
    available_at = clock_timestamp() + make_interval(secs => least(300,30 * q.attempts)),
    error_code = p_error_code,lease_token = NULL,lease_expires_at = NULL,updated_at = clock_timestamp() WHERE request_id = r.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_controlled_render_worker_job(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_controlled_render_worker_job(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.renew_controlled_render_worker_job(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_controlled_render_worker_job(uuid,uuid,text,uuid,uuid,text,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_controlled_render_worker_job(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_controlled_render_worker_job(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_controlled_render_worker_job(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_controlled_render_worker_job(uuid,uuid,text,uuid,uuid,text,boolean,boolean) TO service_role;
-- Rollback: stop worker and revoke queue RPCs; preserve queue/checkpoints/evidence. No automatic failover of local journals.
COMMIT;
