-- PREPARED ONLY. Requires reconstruction library/opening (steps22,24).
-- Bounded current tenant selection by explicit asset UUID, not a global scan.
-- Shared eligibility/metadata avoid a second media policy. No link or Storage write.
BEGIN;
CREATE FUNCTION private.html_reconstruction_resource_eligible(a public.production_assets)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog,public,private AS $$
  SELECT (a).qa_status IN ('GENERATED','READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
      AND (a).checksum ~* '^[a-f0-9]{64}$' AND (a).file_size_bytes BETWEEN 1 AND 2147483648
      AND (a).mime_type IN ('image/png','image/jpeg','image/webp','video/mp4','video/webm',
        'audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm')
      AND (a).storage_bucket IN ('production-assets','production-render-sources','sound-effect-assets')
      AND length((a).storage_path) BETWEEN 1 AND 1024 AND (a).storage_path NOT LIKE '/%'
      AND position('..' IN (a).storage_path) = 0 AND position(chr(92) IN (a).storage_path) = 0
      AND ((a).mime_type LIKE 'image/%' OR (a).duration_milliseconds > 0 OR (a).duration_seconds > 0);
$$;
CREATE FUNCTION private.html_reconstruction_resource_metadata(a public.production_assets,p_role text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog,public,private AS $$
  SELECT jsonb_build_object('productionAssetId',(a).id,'checksum',(a).checksum,'fileSizeBytes',(a).file_size_bytes,'mimeType',(a).mime_type,
      'label',left(coalesce(nullif(CASE WHEN jsonb_typeof((a).metadata->'asset_display_name') = 'string'
          THEN (a).metadata->>'asset_display_name' END,''),nullif(CASE WHEN jsonb_typeof((a).metadata->'file_name') = 'string'
          THEN (a).metadata->>'file_name' END,''),(a).mime_type),200),
      'durationSeconds',CASE WHEN (a).duration_milliseconds > 0 THEN (a).duration_milliseconds::numeric / 1000
        WHEN (a).duration_seconds > 0 THEN (a).duration_seconds ELSE NULL END,
      'hasAudio',CASE WHEN jsonb_typeof((a).metadata->'has_audio') = 'boolean' THEN (a).metadata->'has_audio' ELSE NULL END,
      'sourceWidth',CASE WHEN (a).metadata->>'source_width' ~ '^[0-9]{1,5}$' THEN
        CASE WHEN ((a).metadata->>'source_width')::integer BETWEEN 1 AND 16384 THEN ((a).metadata->>'source_width')::integer END END,
      'sourceHeight',CASE WHEN (a).metadata->>'source_height' ~ '^[0-9]{1,5}$' THEN
        CASE WHEN ((a).metadata->>'source_height')::integer BETWEEN 1 AND 16384 THEN ((a).metadata->>'source_height')::integer END END,
      'timelineRole',CASE WHEN p_role IN ('AUDIO','AVATAR','BROLL','MEDIA','VISUAL','VOICE') THEN p_role
        WHEN (a).metadata->>'timeline_role' IN ('AUDIO','AVATAR','BROLL','MEDIA','VISUAL','VOICE') THEN (a).metadata->>'timeline_role'
        WHEN (a).mime_type LIKE 'audio/%' THEN 'AUDIO' ELSE 'MEDIA' END,
      'timelineVariant',CASE WHEN (a).metadata->>'timeline_variant' IN ('CLIP','FULL') THEN (a).metadata->>'timeline_variant' ELSE NULL END
    );
$$;
CREATE FUNCTION private.html_reconstruction_resource_identity(a public.production_assets)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog,public,private AS $$
  SELECT encode(pg_catalog.sha256(convert_to(jsonb_build_array('courseforge-html-reconstruction-resource-v1',
    (a).organization_id,(a).id,(a).asset_type,(a).qa_status,(a).storage_bucket,(a).storage_path,
    private.html_reconstruction_resource_metadata(a,NULL))::text,'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION private.html_reconstruction_resource_eligible(public.production_assets) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.html_reconstruction_resource_metadata(public.production_assets,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.html_reconstruction_resource_identity(public.production_assets) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_html_reconstruction_library(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
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
    SELECT a AS asset,l.role AS linked_role
    FROM public.video_composition_draft_assets l JOIN public.production_assets a
      ON a.id = l.production_asset_id AND a.organization_id = l.organization_id
    WHERE l.organization_id = p_org AND l.draft_id = p_draft AND a.organization_id = p_org
      AND (p_after_asset IS NULL OR l.production_asset_id > p_after_asset)
      AND private.html_reconstruction_resource_eligible(a)
    ORDER BY l.production_asset_id LIMIT 21
  ), decorated AS (
    SELECT (asset).id AS id,private.html_reconstruction_resource_metadata(asset,linked_role) AS resource FROM available
  ), page AS (SELECT * FROM decorated ORDER BY id LIMIT 20)
  SELECT coalesce(jsonb_agg(resource ORDER BY id),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM available) > 20 THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) END
    INTO resources,next_asset FROM page;
  RETURN jsonb_build_object('scope','CURRENT_LINKED_RECONSTRUCTION_LIBRARY_NOT_RESOURCE_GRANT',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
    'currentDocumentHash',opening->>'currentDocumentHash','currentVersion',opening->'currentVersion',
    'afterAssetId',p_after_asset,'assets',resources,'nextAssetId',next_asset);
END $$;

CREATE FUNCTION public.read_html_reconstruction_resource_candidate(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_asset uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE opening jsonb; asset public.production_assets%ROWTYPE; linked_role text; linked boolean;
BEGIN
  IF p_asset IS NULL THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_UNAVAILABLE'; END IF;
  opening := public.read_html_reconstruction_opening(p_org,p_actor,p_composition,p_draft);
  SELECT * INTO asset FROM public.production_assets WHERE id = p_asset AND organization_id = p_org FOR SHARE;
  IF NOT FOUND OR private.html_reconstruction_resource_eligible(asset) IS DISTINCT FROM true
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_UNAVAILABLE'; END IF;
  SELECT role INTO linked_role FROM public.video_composition_draft_assets
    WHERE organization_id = p_org AND draft_id = p_draft AND production_asset_id = p_asset FOR SHARE;
  linked := FOUND;
  RETURN jsonb_build_object('scope','CURRENT_TENANT_RESOURCE_CANDIDATE_NOT_LINK_OR_APPROVAL',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
    'currentDocumentHash',opening->>'currentDocumentHash','currentVersion',opening->'currentVersion',
    'resourceIdentitySha256',private.html_reconstruction_resource_identity(asset),
    'asset',private.html_reconstruction_resource_metadata(asset,linked_role),'alreadyLinked',linked);
END $$;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_resource_candidate(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_resource_candidate(uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMIT;

