-- PREPARED ONLY: read-only recovery, not a new admission or TTL renewal. No rows rewritten.
-- Publish the function and its restricted grants atomically; no transient PUBLIC execute window.
BEGIN;
CREATE FUNCTION public.read_consumed_composition_render_execution(p_organization_id uuid, p_request_id uuid,
  p_execution_id uuid, p_revision_id uuid, p_production_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE e private.composition_render_executions%ROWTYPE;
BEGIN
  SELECT execution.* INTO e FROM private.composition_render_executions execution
    JOIN public.hyperframes_render_requests r ON r.id = execution.request_id AND r.organization_id = execution.organization_id
    JOIN public.production_jobs j ON j.id = execution.production_job_id AND j.organization_id = execution.organization_id
    JOIN public.video_composition_revisions v ON v.id = execution.revision_id AND v.organization_id = execution.organization_id
    WHERE execution.id = p_execution_id AND execution.organization_id = p_organization_id
      AND execution.request_id = p_request_id AND execution.revision_id = p_revision_id
      AND execution.production_job_id = p_production_job_id AND execution.status = 'CONSUMED'
      AND r.production_job_id = j.id AND r.composition_revision_id = v.id
      AND j.input_snapshot->>'render_backend' = 'CONTROLLED'
      AND j.input_snapshot->>'revision_id' = v.id::text AND j.input_snapshot->>'project_hash' = v.project_hash
      AND v.project_hash = execution.project_hash AND v.manifest->'conformance_contract' = execution.contract
      AND v.manifest->>'draft_document_hash' = execution.document_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- No lease or expiry predicate: only an already committed CONSUMED record can be recovered.
  -- The current key/revocation state is read anew; Node verifies signature at durable consumption time.
  RETURN jsonb_build_object('state','CONSUMED','context',private.composition_render_execution_context(e),
    'receipt',e.receipt,'receiptSha256',e.receipt_sha256,'consumedAtMilliseconds',e.consumed_at_ms);
END $$;
REVOKE ALL ON FUNCTION public.read_consumed_composition_render_execution(uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_consumed_composition_render_execution(uuid,uuid,uuid,uuid,uuid) TO service_role;
-- Rollback: stop the recovery consumer and revoke this RPC. Preserve authority and consumed ledger.
COMMIT;
