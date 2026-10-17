-- PREPARED ONLY. No migration application, routes or template activation.
BEGIN;
CREATE FUNCTION private.html_snapshot_resource_bindings(p_org uuid,p_draft uuid,p_assets jsonb,p_fonts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE bindings jsonb := '[]'::jsonb; asset record; supplied jsonb; font record;
BEGIN
  IF p_assets IS NULL OR p_fonts IS NULL OR jsonb_typeof(p_assets) <> 'array' OR jsonb_typeof(p_fonts) <> 'array'
    OR jsonb_array_length(p_assets) > 250 OR jsonb_array_length(p_fonts) > 32
    OR jsonb_array_length(p_assets) <> (SELECT count(DISTINCT e->>'productionAssetId') FROM jsonb_array_elements(p_assets) e)
    OR jsonb_array_length(p_fonts) <> (SELECT count(DISTINCT e->>'fontAssetId') FROM jsonb_array_elements(p_fonts) e)
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_RESOURCES_INVALID'; END IF;
  -- Set-based acquisition, bounded by manifest IDs; deterministic lock order.
  FOR asset IN SELECT a.* FROM public.production_assets a JOIN public.video_composition_draft_assets l ON l.production_asset_id = a.id
    WHERE a.organization_id = p_org AND l.organization_id = p_org AND l.draft_id = p_draft
      AND a.id IN (SELECT (e->>'productionAssetId')::uuid FROM jsonb_array_elements(p_assets) e)
      AND a.qa_status IN ('GENERATED','READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
    ORDER BY a.id FOR SHARE OF a,l
  LOOP
    bindings := bindings || jsonb_build_array(jsonb_build_object('origin','PRODUCTION','productionAssetId',asset.id,
      'checksum',asset.checksum,'fileSizeBytes',asset.file_size_bytes,'mimeType',asset.mime_type,
      'storageBucket',asset.storage_bucket,'storagePath',asset.storage_path));
  END LOOP;
  FOR asset IN SELECT a.* FROM public.organization_assembly_assets a JOIN public.video_composition_draft_branding b
    ON a.id IN (b.intro_asset_id,b.outro_asset_id)
    WHERE a.organization_id = p_org AND b.organization_id = p_org AND b.draft_id = p_draft AND a.status = 'APPROVED'
      AND a.id IN (SELECT (e->>'productionAssetId')::uuid FROM jsonb_array_elements(p_assets) e)
    ORDER BY a.id FOR SHARE OF a,b
  LOOP
    bindings := bindings || jsonb_build_array(jsonb_build_object('origin','BRANDING','productionAssetId',asset.id,
      'checksum',asset.checksum,'fileSizeBytes',asset.file_size_bytes,'mimeType',asset.mime_type,
      'storageBucket',asset.storage_bucket,'storagePath',asset.storage_path));
  END LOOP;
  FOR asset IN SELECT a.* FROM public.sound_effect_assets a JOIN public.video_composition_draft_sound_effect_assets l ON l.sound_effect_asset_id = a.id
    WHERE a.organization_id = p_org AND l.organization_id = p_org AND l.draft_id = p_draft AND a.status = 'READY'
      AND a.id IN (SELECT (e->>'productionAssetId')::uuid FROM jsonb_array_elements(p_assets) e)
    ORDER BY a.id FOR SHARE OF a,l
  LOOP
    bindings := bindings || jsonb_build_array(jsonb_build_object('origin','SOUND_EFFECT','productionAssetId',asset.id,
      'checksum',asset.checksum_sha256,'fileSizeBytes',asset.file_size_bytes,'mimeType',asset.mime_type,
      'storageBucket',asset.storage_bucket,'storagePath',asset.storage_path));
  END LOOP;
  IF jsonb_array_length(bindings) <> jsonb_array_length(p_assets)
    OR jsonb_array_length(bindings) <> (SELECT count(DISTINCT e->>'productionAssetId') FROM jsonb_array_elements(bindings) e)
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_RESOURCES_FORBIDDEN'; END IF;
  FOR supplied IN SELECT e FROM jsonb_array_elements(p_assets) e LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) e
      WHERE e - 'origin' = supplied) THEN RAISE EXCEPTION 'HTML_SNAPSHOT_RESOURCE_IDENTITY_CHANGED'; END IF;
  END LOOP;
  -- Font permission is tenant-owned READY uploaded bytes, never external CSS.
  FOR font IN SELECT f.* FROM public.organization_slide_fonts f WHERE f.organization_id = p_org
    AND f.id IN (SELECT (e->>'fontAssetId')::uuid FROM jsonb_array_elements(p_fonts) e)
    ORDER BY f.id FOR SHARE
  LOOP
    SELECT e INTO supplied FROM jsonb_array_elements(p_fonts) e WHERE e->>'fontAssetId' = font.id::text;
    IF font.status IS DISTINCT FROM 'READY' OR font.source IS DISTINCT FROM 'uploaded'
      OR font.checksum_sha256 IS DISTINCT FROM supplied->>'checksumSha256'
      OR font.file_size_bytes::text IS DISTINCT FROM supplied->>'fileSizeBytes'
      OR font.mime_type IS DISTINCT FROM supplied->>'mimeType' OR font.family IS DISTINCT FROM supplied->>'family'
      OR font.storage_bucket IS NULL OR font.storage_path IS NULL
      THEN RAISE EXCEPTION 'HTML_SNAPSHOT_FONT_IDENTITY_CHANGED'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.organization_slide_fonts f WHERE f.organization_id = p_org
    AND f.id IN (SELECT (e->>'fontAssetId')::uuid FROM jsonb_array_elements(p_fonts) e)) <> jsonb_array_length(p_fonts)
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_FONT_FORBIDDEN'; END IF;
  RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION private.html_snapshot_resource_bindings(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
