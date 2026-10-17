-- Records a checksum computed from the completed Storage object by a trusted worker.
-- The import remains READY_FOR_QA; this function does not approve visual or audio QA.
CREATE OR REPLACE FUNCTION public.record_hyperframes_final_video_checksum(
  p_organization_id uuid,
  p_request_id uuid,
  p_asset_id uuid,
  p_checksum text,
  p_file_size_bytes bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_request public.hyperframes_render_requests%ROWTYPE;
  v_job public.production_jobs%ROWTYPE;
  v_revision public.video_composition_revisions%ROWTYPE;
  v_asset public.production_assets%ROWTYPE;
  v_expected_path text;
BEGIN
  IF p_checksum IS NULL OR p_checksum !~ '^[a-f0-9]{64}$'
    OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 2147483648 THEN
    RAISE EXCEPTION 'invalid final video checksum or size';
  END IF;

  SELECT * INTO v_request FROM public.hyperframes_render_requests
  WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.provider_status <> 'COMPLETED'
    OR v_request.import_status <> 'COMPLETED' OR v_request.provider_render_id IS NULL THEN
    RAISE EXCEPTION 'render request is not completed';
  END IF;

  SELECT * INTO v_job FROM public.production_jobs
  WHERE id = v_request.production_job_id AND organization_id = p_organization_id FOR UPDATE;
  SELECT * INTO v_revision FROM public.video_composition_revisions
  WHERE id = v_request.composition_revision_id AND organization_id = p_organization_id;
  IF v_job.id IS NULL OR v_job.status <> 'SUCCEEDED' OR v_job.material_component_id IS NULL
    OR v_revision.id IS NULL OR v_job.input_snapshot->>'revision_id' IS DISTINCT FROM v_revision.id::text
    OR v_job.input_snapshot->>'project_hash' IS DISTINCT FROM v_revision.project_hash
    OR v_revision.manifest->>'draft_document_hash' IS DISTINCT FROM v_revision.manifest #>> '{conformance_contract,documentHash}'
    OR v_job.output_snapshot #>> '{final_video,asset_id}' IS DISTINCT FROM p_asset_id::text THEN
    RAISE EXCEPTION 'render job or revision lineage mismatch';
  END IF;

  SELECT * INTO v_asset FROM public.production_assets
  WHERE id = p_asset_id AND organization_id = p_organization_id FOR UPDATE;
  v_expected_path := 'production-videos/organizations/' || p_organization_id::text
    || '/artifacts/' || v_job.artifact_id::text
    || '/components/' || v_job.material_component_id::text
    || '/renders/' || p_request_id::text || '/final.mp4';
  IF v_asset.id IS NULL OR v_asset.production_job_id IS DISTINCT FROM v_job.id
    OR v_asset.provider IS DISTINCT FROM 'hyperframes' OR v_asset.asset_type <> 'FINAL_VIDEO'
    OR v_asset.metadata->>'render_request_id' IS DISTINCT FROM p_request_id::text
    OR v_asset.metadata->>'provider_render_id' IS DISTINCT FROM v_request.provider_render_id
    OR v_asset.storage_bucket IS DISTINCT FROM 'production-videos'
    OR v_asset.storage_path IS DISTINCT FROM v_expected_path
    OR v_asset.mime_type IS DISTINCT FROM 'video/mp4'
    OR v_asset.file_size_bytes IS DISTINCT FROM p_file_size_bytes THEN
    RAISE EXCEPTION 'final video asset lineage mismatch';
  END IF;
  IF v_asset.checksum IS NOT NULL AND v_asset.checksum IS DISTINCT FROM p_checksum THEN
    RAISE EXCEPTION 'final video checksum conflict';
  END IF;

  UPDATE public.production_assets
  SET checksum = p_checksum,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'integrity_method', 'storage-stream-sha256-v1',
        'integrity_verified_at', now()
      ),
      updated_at = now()
  WHERE id = p_asset_id;
  RETURN p_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_hyperframes_final_video_checksum(uuid, uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_final_video_checksum(uuid, uuid, uuid, text, bigint)
  TO service_role;

-- Tenant members may review QA fields, but cannot forge the trusted digest or
-- change the storage identity on which the verification above depends.
CREATE OR REPLACE FUNCTION private.protect_hyperframes_final_video_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.provider = 'hyperframes' AND NEW.asset_type = 'FINAL_VIDEO'
      AND current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'final video integrity fields are server-managed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.provider = 'hyperframes' AND NEW.asset_type = 'FINAL_VIDEO'
    AND (OLD.provider IS DISTINCT FROM NEW.provider OR OLD.asset_type IS DISTINCT FROM NEW.asset_type)
    AND current_user NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'final video integrity fields are server-managed';
  END IF;
  IF OLD.provider = 'hyperframes' AND OLD.asset_type = 'FINAL_VIDEO'
    AND current_user NOT IN ('service_role', 'postgres') THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.production_job_id IS DISTINCT FROM OLD.production_job_id
      OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.asset_type IS DISTINCT FROM OLD.asset_type
      OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
      OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.checksum IS DISTINCT FROM OLD.checksum
      OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      RAISE EXCEPTION 'final video integrity fields are read-only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_hyperframes_final_video_integrity ON public.production_assets;
CREATE TRIGGER protect_hyperframes_final_video_integrity
BEFORE INSERT OR UPDATE ON public.production_assets
FOR EACH ROW EXECUTE FUNCTION private.protect_hyperframes_final_video_integrity();

REVOKE ALL ON FUNCTION private.protect_hyperframes_final_video_integrity()
  FROM PUBLIC, anon, authenticated;
