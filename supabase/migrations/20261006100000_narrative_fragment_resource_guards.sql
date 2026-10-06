-- PREPARED ONLY: do not apply or enable audiovisual extraction before integration review.
-- Internal resource guard; this migration does NOT implement the commit RPC.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE FUNCTION private.validate_narrative_fragment_resources(p_org uuid,p_draft uuid,p_component uuid,
  p_document jsonb,p_plan jsonb,p_clips jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  asset public.production_assets%ROWTYPE; font public.organization_slide_fonts%ROWTYPE;
  supplied jsonb; clip jsonb; scene jsonb; binding_count integer := 0; font_count integer := 0;
  source_end numeric; interval_start numeric; interval_end numeric;
BEGIN
  IF p_org IS NULL OR p_draft IS NULL OR p_component IS NULL OR p_plan IS NULL OR p_clips IS NULL
    OR jsonb_typeof(p_plan->'assets') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_plan->'fontBindings') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_clips) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_clips) NOT BETWEEN 2 AND 48
    OR jsonb_array_length(p_plan->'assets') NOT BETWEEN 1 AND 48
    OR jsonb_array_length(p_plan->'fontBindings')>32
    OR jsonb_array_length(p_plan->'assets')<>(SELECT count(DISTINCT e->>'assetId') FROM jsonb_array_elements(p_plan->'assets') e)
    OR jsonb_array_length(p_plan->'fontBindings')<>(SELECT count(DISTINCT e->>'fontAssetId') FROM jsonb_array_elements(p_plan->'fontBindings') e)
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_RESOURCES_INVALID'; END IF;
  interval_start := (p_plan->>'sourceStartSeconds')::numeric;
  interval_end := (p_plan->>'sourceEndSeconds')::numeric;
  IF interval_start IS NULL OR interval_end IS NULL OR interval_start<0 OR interval_end<=interval_start
    OR interval_end-interval_start>120 THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_INTERVAL_INVALID'; END IF;
  -- Exactly the production sources retained by the complete document-delta validator.
  IF EXISTS(SELECT e->>'assetId' FROM jsonb_array_elements(p_plan->'assets') e EXCEPT
      SELECT c#>>'{source,productionAssetId}' FROM jsonb_array_elements(p_clips) c WHERE c#>>'{source,type}'='PRODUCTION_ASSET')
    OR EXISTS(SELECT c#>>'{source,productionAssetId}' FROM jsonb_array_elements(p_clips) c WHERE c#>>'{source,type}'='PRODUCTION_ASSET' EXCEPT
      SELECT e->>'assetId' FROM jsonb_array_elements(p_plan->'assets') e)
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_ASSET_SET_INVALID'; END IF;
  -- Draft is locked by the future caller first. SHARE prevents deletion and non-key metadata changes.
  -- Bound manifests and ordered IDs avoid unbounded scans/lock acquisition and inconsistent order.
  FOR asset IN SELECT a.* FROM public.production_assets a JOIN public.video_composition_draft_assets l ON l.production_asset_id=a.id
    WHERE a.organization_id=p_org AND a.material_component_id=p_component AND l.organization_id=p_org AND l.draft_id=p_draft
      AND a.id IN (SELECT (e->>'assetId')::uuid FROM jsonb_array_elements(p_plan->'assets') e)
    ORDER BY a.id FOR SHARE OF a,l NOWAIT
  LOOP
    binding_count := binding_count+1;
    SELECT e INTO supplied FROM jsonb_array_elements(p_plan->'assets') e WHERE e->>'assetId'=asset.id::text;
    IF asset.checksum IS NULL OR asset.checksum !~ '^[a-f0-9]{64}$'
      OR asset.checksum IS DISTINCT FROM supplied->>'checksum'
      OR asset.qa_status IS DISTINCT FROM supplied->>'qaStatus'
      OR coalesce(asset.qa_status,'') NOT IN ('READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
      OR asset.duration_milliseconds IS DISTINCT FROM (supplied->>'durationMilliseconds')::bigint
      OR (asset.duration_milliseconds IS NOT NULL AND asset.duration_milliseconds<=0)
      THEN RETURN 'ASSET_CHANGED'; END IF;
    FOR clip IN SELECT c FROM jsonb_array_elements(p_clips) c WHERE c#>>'{source,productionAssetId}'=asset.id::text LOOP
      IF (clip->>'kind'='AUDIO' AND (asset.mime_type IS NULL OR asset.mime_type !~* '^audio/'
          OR coalesce(asset.asset_type,'') NOT IN ('VOICE_AUDIO','PROCESSED_AUDIO','SOURCE_MEDIA')))
        OR (clip->>'kind'='VIDEO' AND (asset.mime_type IS NULL OR asset.mime_type !~* '^video/'
          OR coalesce(asset.asset_type,'') NOT IN ('AVATAR_VIDEO_CLIP','AVATAR_VIDEO','SOURCE_MEDIA','FINAL_VIDEO')))
        OR (clip->>'kind'='IMAGE' AND (asset.mime_type IS NULL OR asset.mime_type !~* '^image/' OR asset.asset_type IS DISTINCT FROM 'SOURCE_MEDIA'))
        OR coalesce(clip->>'kind','') NOT IN ('AUDIO','VIDEO','IMAGE') THEN RETURN 'ASSET_CHANGED'; END IF;
      IF clip->>'kind'<>'IMAGE' THEN
        source_end := coalesce((clip->>'sourceOffsetSeconds')::numeric,0)
          + least(interval_end,(clip->>'startSeconds')::numeric+(clip->>'durationSeconds')::numeric)-(clip->>'startSeconds')::numeric;
        IF source_end IS NULL OR asset.duration_milliseconds IS NULL OR asset.duration_milliseconds<=0
          OR source_end>asset.duration_milliseconds::numeric/1000 THEN RETURN 'ASSET_CHANGED'; END IF;
      END IF;
      IF clip->>'id'=p_plan#>>'{anchor,sourceClipId}' THEN
        SELECT s INTO scene FROM jsonb_array_elements(coalesce(p_document->'narrativeScenes','[]'::jsonb)) s WHERE s->>'id'=clip->>'sceneId';
        IF asset.asset_type IS DISTINCT FROM 'VOICE_AUDIO' OR scene IS NULL
          OR asset.id::text IS DISTINCT FROM p_plan#>>'{anchor,sourceAssetId}'
          OR asset.checksum IS DISTINCT FROM p_plan#>>'{anchor,sourceChecksum}'
          OR asset.qa_status IS DISTINCT FROM p_plan#>>'{anchor,sourceQaStatus}'
          OR asset.duration_milliseconds IS DISTINCT FROM (p_plan#>>'{anchor,sourceDurationMilliseconds}')::bigint
          OR asset.metadata->>'script_hash' IS DISTINCT FROM p_plan#>>'{anchor,sourceScriptHash}'
          OR asset.metadata->>'script_hash' IS NULL OR asset.metadata->>'script_hash' !~ '^[a-f0-9]{64}$'
          OR scene->>'scriptHash' IS DISTINCT FROM asset.metadata->>'script_hash'
          OR scene->'wordTimestamps' IS DISTINCT FROM asset.metadata->'word_timestamps'
          THEN RETURN 'ASSET_CHANGED'; END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF binding_count<>jsonb_array_length(p_plan->'assets') THEN RETURN 'ASSET_CHANGED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_clips) c
    WHERE c->>'id'=p_plan#>>'{anchor,sourceClipId}' AND c#>>'{source,type}'='PRODUCTION_ASSET')
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_ANCHOR_MISSING'; END IF;
  -- Only copied native text/captions require these fonts; external CSS is never authorized here.
  IF EXISTS(SELECT e->>'fontAssetId' FROM jsonb_array_elements(p_plan->'fontBindings') e EXCEPT
      SELECT c#>>'{source,style,fontAssetId}' FROM jsonb_array_elements(p_clips) c
      WHERE c#>>'{source,type}' IN ('NATIVE_TEXT','NATIVE_CAPTIONS') AND c#>>'{source,style,fontAssetId}' IS NOT NULL)
    OR EXISTS(SELECT c#>>'{source,style,fontAssetId}' FROM jsonb_array_elements(p_clips) c
      WHERE c#>>'{source,type}' IN ('NATIVE_TEXT','NATIVE_CAPTIONS') AND c#>>'{source,style,fontAssetId}' IS NOT NULL EXCEPT
      SELECT e->>'fontAssetId' FROM jsonb_array_elements(p_plan->'fontBindings') e)
    THEN RETURN 'FONT_CHANGED'; END IF;
  FOR font IN SELECT f.* FROM public.organization_slide_fonts f WHERE f.organization_id=p_org
    AND f.id IN (SELECT (e->>'fontAssetId')::uuid FROM jsonb_array_elements(p_plan->'fontBindings') e)
    ORDER BY f.id FOR SHARE NOWAIT
  LOOP
    font_count := font_count+1;
    SELECT e INTO supplied FROM jsonb_array_elements(p_plan->'fontBindings') e WHERE e->>'fontAssetId'=font.id::text;
    IF font.source IS DISTINCT FROM 'uploaded' OR font.status IS DISTINCT FROM 'READY'
      OR font.family IS DISTINCT FROM supplied->>'family' OR font.checksum_sha256 IS DISTINCT FROM supplied->>'checksumSha256'
      OR font.checksum_sha256 IS NULL OR font.checksum_sha256 !~ '^[a-f0-9]{64}$'
      OR font.mime_type IS DISTINCT FROM supplied->>'mimeType' OR coalesce(font.mime_type,'') NOT IN ('font/woff','font/woff2','font/ttf','font/otf')
      OR font.file_size_bytes IS DISTINCT FROM (supplied->>'fileSizeBytes')::bigint
      OR font.file_size_bytes IS NULL OR font.file_size_bytes NOT BETWEEN 1 AND 52428800
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_clips) c WHERE c#>>'{source,style,fontAssetId}'=font.id::text
        AND c#>>'{source,style,fontFamily}' IS DISTINCT FROM font.family)
      THEN RETURN 'FONT_CHANGED'; END IF;
  END LOOP;
  IF font_count<>jsonb_array_length(p_plan->'fontBindings') THEN RETURN 'FONT_CHANGED'; END IF;
  RETURN 'OK';
  -- Do not catch lock_not_available here: the commit's exception boundary must roll back the whole transaction.
END $$;
REVOKE ALL ON FUNCTION private.validate_narrative_fragment_resources(uuid,uuid,uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
