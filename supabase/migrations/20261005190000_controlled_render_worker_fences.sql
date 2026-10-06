-- PREPARED ONLY. Apply with queue migration and host release; do not enable worker/CONTROLLED here.
BEGIN;
CREATE FUNCTION private.assert_controlled_render_worker_lease(p_organization_id uuid,p_request_id uuid,p_worker_lease_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE q private.controlled_render_worker_jobs%ROWTYPE;
BEGIN
  -- Exclusive request-first lock prevents request/queue inversion and holds ownership through the delegated write.
  PERFORM 1 FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_LEASE_REJECTED'; END IF;
  SELECT * INTO q FROM private.controlled_render_worker_jobs WHERE request_id = p_request_id FOR SHARE;
  IF NOT FOUND THEN
    IF p_worker_lease_token IS NOT NULL THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_LEASE_REJECTED'; END IF;
    RETURN; -- Explicit legacy compatibility only for requests that have never been enrolled in this queue.
  END IF;
  IF q.organization_id <> p_organization_id OR q.status <> 'RUNNING'
    OR p_worker_lease_token IS NULL OR q.lease_token IS DISTINCT FROM p_worker_lease_token
    OR q.lease_expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_LEASE_REJECTED'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_controlled_render_worker_lease(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.issue_composition_render_execution(uuid,uuid,uuid,text,text,jsonb,text) SET SCHEMA private;
ALTER FUNCTION public.consume_composition_render_execution(uuid,uuid,uuid,uuid,jsonb,text) SET SCHEMA private;
ALTER FUNCTION public.cancel_composition_render_execution(uuid,uuid,uuid,uuid) SET SCHEMA private;
ALTER FUNCTION public.read_controlled_render_upload(uuid,uuid,uuid,text) SET SCHEMA private;
ALTER FUNCTION public.save_controlled_render_upload(uuid,uuid,uuid,text,text,text) SET SCHEMA private;
ALTER FUNCTION public.finalize_controlled_composition_render(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.issue_composition_render_execution(uuid,uuid,uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.consume_composition_render_execution(uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.cancel_composition_render_execution(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.read_controlled_render_upload(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.save_controlled_render_upload(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.finalize_controlled_composition_render(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_composition_render_execution(p_organization_id uuid,p_request_id uuid,p_issuance_id uuid,
  p_supervisor_id text,p_key_id text,p_contract jsonb,p_contract_sha256 text,p_worker_lease_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  IF EXISTS (SELECT 1 FROM private.controlled_render_worker_jobs q WHERE q.request_id = p_request_id
    AND (q.issuance_id IS DISTINCT FROM p_issuance_id OR q.supervisor_id IS DISTINCT FROM p_supervisor_id OR q.key_id IS DISTINCT FROM p_key_id)) THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_WORKER_ISSUANCE_REJECTED';
  END IF;
  result := private.issue_composition_render_execution(p_organization_id,p_request_id,p_issuance_id,p_supervisor_id,p_key_id,p_contract,p_contract_sha256);
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  RETURN result;
END $$;

CREATE FUNCTION public.consume_composition_render_execution(p_organization_id uuid,p_request_id uuid,p_execution_id uuid,
  p_lease_token uuid,p_receipt jsonb,p_receipt_sha256 text,p_worker_lease_token uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result boolean;
BEGIN
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  result := private.consume_composition_render_execution(p_organization_id,p_request_id,p_execution_id,p_lease_token,p_receipt,p_receipt_sha256);
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  RETURN result;
END $$;

CREATE FUNCTION public.cancel_composition_render_execution(p_organization_id uuid,p_request_id uuid,p_execution_id uuid,
  p_lease_token uuid,p_worker_lease_token uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result boolean;
BEGIN
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  result := private.cancel_composition_render_execution(p_organization_id,p_request_id,p_execution_id,p_lease_token);
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  RETURN result;
END $$;

CREATE FUNCTION public.read_controlled_render_upload(p_organization_id uuid,p_request_id uuid,p_execution_id uuid,
  p_receipt_sha256 text,p_worker_lease_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result jsonb;
BEGIN
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  result := private.read_controlled_render_upload(p_organization_id,p_request_id,p_execution_id,p_receipt_sha256);
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  RETURN result;
END $$;

CREATE FUNCTION public.save_controlled_render_upload(p_organization_id uuid,p_request_id uuid,p_execution_id uuid,
  p_receipt_sha256 text,p_expected_upload_url text,p_upload_url text,p_worker_lease_token uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result boolean;
BEGIN
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  result := private.save_controlled_render_upload(p_organization_id,p_request_id,p_execution_id,p_receipt_sha256,p_expected_upload_url,p_upload_url);
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  RETURN result;
END $$;

CREATE FUNCTION public.finalize_controlled_composition_render(p_organization_id uuid,p_request_id uuid,p_execution_id uuid,
  p_revision_id uuid,p_production_job_id uuid,p_receipt_sha256 text,p_video_sha256 text,p_size_bytes bigint,p_public_url text,
  p_worker_lease_token uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE result uuid;
BEGIN
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  result := private.finalize_controlled_composition_render(p_organization_id,p_request_id,p_execution_id,p_revision_id,p_production_job_id,
    p_receipt_sha256,p_video_sha256,p_size_bytes,p_public_url);
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.issue_composition_render_execution(uuid,uuid,uuid,text,text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.consume_composition_render_execution(uuid,uuid,uuid,uuid,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_composition_render_execution(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_controlled_render_upload(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_controlled_render_upload(uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_controlled_composition_render(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_composition_render_execution(uuid,uuid,uuid,text,text,jsonb,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_composition_render_execution(uuid,uuid,uuid,uuid,jsonb,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_composition_render_execution(uuid,uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_controlled_render_upload(uuid,uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_controlled_render_upload(uuid,uuid,uuid,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_controlled_composition_render(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) TO service_role;
-- Rollback: stop workers/revoke guarded RPCs; do not expose private delegates while queued ownership exists.
-- Keep queue and consumed receipts. Restoring legacy entrypoints requires explicit unenrollment/recovery policy.
COMMIT;
