-- PREPARED ONLY: no worker activation, credentials, Storage policy change or migration application.
BEGIN;
CREATE TABLE private.composition_render_upload_sessions (
  execution_id uuid PRIMARY KEY REFERENCES private.composition_render_executions(id) ON DELETE CASCADE,
  upload_url text NOT NULL CHECK (length(upload_url) BETWEEN 1 AND 2048),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.composition_render_upload_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_render_upload_sessions FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_controlled_render_upload_authority(p_organization_id uuid,p_request_id uuid,
  p_execution_id uuid,p_receipt_sha256 text)
RETURNS private.composition_render_executions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,public,private AS $$
DECLARE e private.composition_render_executions%ROWTYPE; r public.hyperframes_render_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.hyperframes_render_requests
    WHERE id = p_request_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND OR r.cancelled_at IS NOT NULL OR r.provider_render_id IS NOT NULL
    OR r.provider_status NOT IN ('PENDING','RUNNING','COMPLETED') THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_UPLOAD_AUTHORITY_INVALID';
  END IF;
  SELECT * INTO e FROM private.composition_render_executions WHERE id = p_execution_id
    AND request_id = r.id AND organization_id = p_organization_id
    AND production_job_id = r.production_job_id AND revision_id = r.composition_revision_id FOR SHARE;
  IF NOT FOUND OR e.status <> 'CONSUMED' OR e.receipt_sha256 IS DISTINCT FROM p_receipt_sha256 THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_UPLOAD_AUTHORITY_INVALID';
  END IF;
  PERFORM 1 FROM private.composition_render_supervisor_keys k WHERE k.organization_id = e.organization_id
    AND k.supervisor_id = e.supervisor_id AND k.key_id = e.key_id AND NOT k.revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_UPLOAD_AUTHORITY_INVALID'; END IF;
  PERFORM 1 FROM public.production_jobs j WHERE j.id = e.production_job_id AND j.organization_id = e.organization_id
    AND j.status IN ('PENDING','QUEUED','RUNNING','SUCCEEDED')
    AND j.input_snapshot->>'render_backend' = 'CONTROLLED'
    AND j.input_snapshot->>'revision_id' = e.revision_id::text
    AND j.input_snapshot->>'project_hash' = e.project_hash FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_UPLOAD_AUTHORITY_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_revisions v WHERE v.id = e.revision_id
    AND v.organization_id = e.organization_id AND v.project_hash = e.project_hash
    AND v.manifest->'conformance_contract' = e.contract
    AND v.manifest->>'draft_document_hash' = e.document_hash FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_UPLOAD_AUTHORITY_INVALID'; END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION private.assert_controlled_render_upload_authority(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_controlled_render_upload(p_organization_id uuid,p_request_id uuid,
  p_execution_id uuid,p_receipt_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE e private.composition_render_executions%ROWTYPE; session_url text; object_path text;
BEGIN
  e := private.assert_controlled_render_upload_authority(p_organization_id,p_request_id,p_execution_id,p_receipt_sha256);
  SELECT upload_url INTO session_url FROM private.composition_render_upload_sessions WHERE execution_id = e.id;
  object_path := 'organizations/' || e.organization_id::text || '/controlled-renders/'
    || e.request_id::text || '/' || e.id::text || '/' || (e.receipt#>>'{payload,binding,videoSha256}') || '.mp4';
  -- Existing object is a hint only: Node finalizer still streams and verifies every byte.
  RETURN jsonb_build_object('uploadUrl',session_url,'objectExists',EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'production-videos' AND name = object_path));
END $$;

CREATE FUNCTION public.save_controlled_render_upload(p_organization_id uuid,p_request_id uuid,
  p_execution_id uuid,p_receipt_sha256 text,p_expected_upload_url text,p_upload_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE e private.composition_render_executions%ROWTYPE; updated_count integer;
BEGIN
  e := private.assert_controlled_render_upload_authority(p_organization_id,p_request_id,p_execution_id,p_receipt_sha256);
  -- Host enforces exact project origin before saving/sending a token; no secret/query is stored here.
  IF p_upload_url IS NULL OR length(p_upload_url) > 2048
    OR p_upload_url !~ '^https://[^/?#@]+/storage/v1/upload/resumable/[a-zA-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_UPLOAD_URL_INVALID';
  END IF;
  IF p_expected_upload_url IS NULL THEN
    INSERT INTO private.composition_render_upload_sessions(execution_id,upload_url) VALUES (e.id,p_upload_url)
      ON CONFLICT (execution_id) DO NOTHING;
  ELSE
    UPDATE private.composition_render_upload_sessions SET upload_url = p_upload_url,updated_at = now()
      WHERE execution_id = e.id AND upload_url = p_expected_upload_url;
  END IF;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END $$;
REVOKE ALL ON FUNCTION public.read_controlled_render_upload(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_controlled_render_upload(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_controlled_render_upload(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_controlled_render_upload(uuid,uuid,uuid,text,text,text) TO service_role;
-- Rollback: stop uploader and revoke both RPCs; keep session URLs for recovery, no object deletion.
COMMIT;
