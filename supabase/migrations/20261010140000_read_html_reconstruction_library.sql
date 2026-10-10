-- PREPARED ONLY. Requires read_html_reconstruction_opening (step22).
-- Read CURRENT links on the NEW draft, never the original component library.
-- Page metadata is discovery only. Existing edit/preview/snapshot consumers
-- must still enforce current resource grants; this function attaches nothing.
BEGIN;
CREATE FUNCTION public.read_html_reconstruction_library(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_after_asset uuid,p_expected_hash text,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE opening jsonb; resources jsonb; next_asset uuid;
BEGIN
  IF (p_after_asset IS NULL) IS DISTINCT FROM (p_expected_hash IS NULL)
    OR (p_after_asset IS NULL) IS DISTINCT FROM (p_expected_version IS NULL)
    OR (p_expected_hash IS NOT NULL AND p_expected_hash !~ '^[a-f0-9]{64}$')
    OR (p_expected_version IS NOT NULL AND p_expected_version <= 0)
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_LIBRARY_INVALID'; END IF;
  -- Reuse current provenance/membership/role/draft/composition authorization and
  -- draft-first FOR SHARE locks. A creation receipt is not current authority.
  opening := public.read_html_reconstruction_opening(p_org,p_actor,p_composition,p_draft);
  IF p_after_asset IS NOT NULL AND (opening->>'currentDocumentHash' IS DISTINCT FROM p_expected_hash
    OR (opening->>'currentVersion')::integer IS DISTINCT FROM p_expected_version)
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_LIBRARY_BASE_CHANGED'; END IF;
  WITH available AS (
    SELECT a.id,a.checksum,a.file_size_bytes,a.mime_type,a.duration_milliseconds,a.duration_seconds,a.metadata,l.role
    FROM public.video_composition_draft_assets l JOIN public.production_assets a
      ON a.id = l.production_asset_id AND a.organization_id = l.organization_id
    WHERE l.organization_id = p_org AND l.draft_id = p_draft AND a.organization_id = p_org
      AND (p_after_asset IS NULL OR l.production_asset_id > p_after_asset)
      AND a.qa_status IN ('GENERATED','READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
      AND a.checksum ~* '^[a-f0-9]{64}$' AND a.file_size_bytes BETWEEN 1 AND 2147483648
      AND a.mime_type IN ('image/png','image/jpeg','image/webp','video/mp4','video/webm',
        'audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm')
      AND a.storage_bucket IN ('production-assets','production-render-sources','sound-effect-assets')
      AND length(a.storage_path) BETWEEN 1 AND 1024 AND a.storage_path NOT LIKE '/%'
      AND position('..' IN a.storage_path) = 0 AND position(chr(92) IN a.storage_path) = 0
      AND (a.mime_type LIKE 'image/%' OR a.duration_milliseconds > 0 OR a.duration_seconds > 0)
    ORDER BY l.production_asset_id LIMIT 21
  ), decorated AS (
    SELECT id,jsonb_build_object('productionAssetId',id,'checksum',checksum,'fileSizeBytes',file_size_bytes,'mimeType',mime_type,
      'label',left(coalesce(nullif(CASE WHEN jsonb_typeof(metadata->'asset_display_name') = 'string'
          THEN metadata->>'asset_display_name' END,''),nullif(CASE WHEN jsonb_typeof(metadata->'file_name') = 'string'
          THEN metadata->>'file_name' END,''),mime_type),200),
      'durationSeconds',CASE WHEN duration_milliseconds > 0 THEN duration_milliseconds::numeric / 1000
        WHEN duration_seconds > 0 THEN duration_seconds ELSE NULL END,
      'hasAudio',CASE WHEN jsonb_typeof(metadata->'has_audio') = 'boolean' THEN metadata->'has_audio' ELSE NULL END,
      'sourceWidth',CASE WHEN metadata->>'source_width' ~ '^[0-9]{1,5}$' THEN
        CASE WHEN (metadata->>'source_width')::integer BETWEEN 1 AND 16384 THEN (metadata->>'source_width')::integer END END,
      'sourceHeight',CASE WHEN metadata->>'source_height' ~ '^[0-9]{1,5}$' THEN
        CASE WHEN (metadata->>'source_height')::integer BETWEEN 1 AND 16384 THEN (metadata->>'source_height')::integer END END,
      'timelineRole',CASE WHEN role IN ('AUDIO','AVATAR','BROLL','MEDIA','VISUAL','VOICE') THEN role
        WHEN metadata->>'timeline_role' IN ('AUDIO','AVATAR','BROLL','MEDIA','VISUAL','VOICE') THEN metadata->>'timeline_role'
        WHEN mime_type LIKE 'audio/%' THEN 'AUDIO' ELSE 'MEDIA' END,
      'timelineVariant',CASE WHEN metadata->>'timeline_variant' IN ('CLIP','FULL') THEN metadata->>'timeline_variant' ELSE NULL END
    ) AS resource FROM available
  ), page AS (SELECT * FROM decorated ORDER BY id LIMIT 20)
  SELECT coalesce(jsonb_agg(resource ORDER BY id),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM available) > 20 THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) END
    INTO resources,next_asset FROM page;
  RETURN jsonb_build_object('scope','CURRENT_LINKED_RECONSTRUCTION_LIBRARY_NOT_RESOURCE_GRANT',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
    'currentDocumentHash',opening->>'currentDocumentHash','currentVersion',opening->'currentVersion',
    'afterAssetId',p_after_asset,'assets',resources,'nextAssetId',next_asset);
END $$;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_library(uuid,uuid,uuid,uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_library(uuid,uuid,uuid,uuid,uuid,text,integer) TO service_role;
COMMIT;
