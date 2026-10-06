-- PREPARED ONLY. Deploy the claim-bound writer before applying this gate.
-- Historical rows remain readable; old workers cannot finalize new unbound reports afterwards.
DO $$
BEGIN
  IF to_regprocedure('private.finish_hyperframes_conformance_job_before_attempt(uuid,uuid,jsonb,text,boolean)') IS NULL THEN
    ALTER FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) SET SCHEMA private;
    ALTER FUNCTION private.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean)
      RENAME TO finish_hyperframes_conformance_job_before_attempt;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.finish_hyperframes_conformance_job_before_attempt(uuid, uuid, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finish_hyperframes_conformance_job(
  p_job_id uuid, p_lease_token uuid, p_report jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_retryable boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  v_job private.hyperframes_conformance_jobs%ROWTYPE;
  v_binding jsonb;
BEGIN
  SELECT * INTO v_job FROM private.hyperframes_conformance_jobs
    WHERE id = p_job_id AND lease_token = p_lease_token AND status = 'RUNNING'
      AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_report IS NOT NULL THEN
    -- Domain-separated SHA-256 is correlation, NOT an authenticated renderer signature.
    v_binding := jsonb_build_object(
      'policy', 'CLAIM_BOUND_REPORT_NOT_RENDER_ATTESTATION_V1',
      'jobId', v_job.id::text, 'attempt', v_job.attempts,
      'leaseFingerprint', encode(sha256(convert_to(
        'CLAIM_BOUND_REPORT_NOT_RENDER_ATTESTATION_V1:' || v_job.lease_token::text, 'UTF8')), 'hex'));
    IF p_report->'attemptBinding' IS DISTINCT FROM v_binding THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_ATTEMPT_BINDING_INVALID';
    END IF;
  END IF;
  -- All existing tenant/revision/asset/evidence/PASS gates still execute in the same transaction.
  RETURN private.finish_hyperframes_conformance_job_before_attempt(
    p_job_id, p_lease_token, p_report, p_error_code, p_retryable);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) TO service_role;

-- Rollback (explicit operator action): restore the previous public function and its grants.
-- No rows are rewritten or deleted; rolling back removes this additional attempt-binding gate.
