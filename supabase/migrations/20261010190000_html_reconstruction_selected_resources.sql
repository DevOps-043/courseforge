-- PREPARED ONLY. Incremental step29 after28; requires steps16,20,21,23,25.
-- Explicit current-tenant selection; old candidates retain source-draft semantics.
-- No migration application, flags/catalogue activation, source writes or rendering.
BEGIN;
CREATE FUNCTION private.assert_html_reconstruction_selected_origin(p_org uuid,p_actor uuid,p_origin jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE archive jsonb; field text;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR jsonb_typeof(p_origin) IS DISTINCT FROM 'object'
    OR octet_length(p_origin::text) > 4096 THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_origin)) <> 9
    OR p_origin->>'scope' IS DISTINCT FROM 'AUTHORIZED_RECONSTRUCTION_ORIGIN_NOT_EXECUTION_OR_APPROVAL'
    OR p_origin->>'organizationId' IS DISTINCT FROM p_org::text
    OR EXISTS (SELECT 1 FROM jsonb_each(p_origin) e WHERE jsonb_typeof(e.value) <> 'string')
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  FOREACH field IN ARRAY ARRAY['compositionId','draftId','revisionId','documentId'] LOOP
    IF coalesce(p_origin->>field,'') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['documentHash','projectHash','bundleSha256'] LOOP
    IF coalesce(p_origin->>field,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  END LOOP;
  -- Existing reader locks current draft/membership/composition and exact history.
  archive := public.read_html_editing_snapshot_archive(p_org,p_actor,(p_origin->>'compositionId')::uuid,
    (p_origin->>'draftId')::uuid,(p_origin->>'revisionId')::uuid);
  IF archive->>'documentId' IS DISTINCT FROM p_origin->>'documentId'
    OR archive->>'documentHash' IS DISTINCT FROM p_origin->>'documentHash'
    OR archive->>'projectHash' IS DISTINCT FROM p_origin->>'projectHash'
    OR archive#>>'{bundlePin,sha256}' IS DISTINCT FROM p_origin->>'bundleSha256'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_ORIGIN_CHANGED'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_html_reconstruction_selected_origin(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.html_reconstruction_selected_bindings(p_org uuid,p_actor uuid,p_origin jsonb,p_selection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE bindings jsonb := '[]'::jsonb; production_ids uuid[]; sound_ids uuid[]; brand_ids uuid[]; all_ids uuid[];
  asset record; field text; placements jsonb;
BEGIN
  PERFORM private.assert_html_reconstruction_selected_origin(p_org,p_actor,p_origin);
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR octet_length(p_selection::text) > 32768
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_selection)) <> 4
    OR p_selection->>'scope' IS DISTINCT FROM 'CURRENT_TENANT_RESOURCE_SELECTION_NOT_GRANTS'
    OR jsonb_typeof(p_selection->'productionAssetIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_selection->'soundEffectAssetIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_selection->'branding') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_selection->'branding')) <> 2
    OR NOT (p_selection->'branding' ?& ARRAY['introAssetId','outroAssetId'])
    OR jsonb_array_length(p_selection->'productionAssetIds') > 250
    OR jsonb_array_length(p_selection->'soundEffectAssetIds') > 250
    OR EXISTS (SELECT 1 FROM jsonb_array_elements((p_selection->'productionAssetIds')||(p_selection->'soundEffectAssetIds')) e
      WHERE jsonb_typeof(e) <> 'string' OR trim(both '"' from e::text) !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  FOREACH field IN ARRAY ARRAY['introAssetId','outroAssetId'] LOOP
    IF p_selection#>ARRAY['branding',field] IS DISTINCT FROM 'null'::jsonb AND (
      jsonb_typeof(p_selection#>ARRAY['branding',field]) IS DISTINCT FROM 'string'
      OR coalesce(p_selection#>>ARRAY['branding',field],'') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  END LOOP;
  SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),'{}'::uuid[]) INTO production_ids
    FROM jsonb_array_elements_text(p_selection->'productionAssetIds');
  SELECT coalesce(array_agg(value::uuid ORDER BY value::uuid),'{}'::uuid[]) INTO sound_ids
    FROM jsonb_array_elements_text(p_selection->'soundEffectAssetIds');
  SELECT coalesce(array_agg(DISTINCT value::uuid ORDER BY value::uuid),'{}'::uuid[]) INTO brand_ids
    FROM jsonb_each_text(p_selection->'branding') WHERE value IS NOT NULL;
  all_ids := production_ids||sound_ids||brand_ids;
  IF cardinality(all_ids) > 250 OR cardinality(all_ids) <> (SELECT count(DISTINCT id) FROM unnest(all_ids) id)
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_INVALID'; END IF;
  -- All source tables are addressed by explicit IDs and tenant, no global scan or
  -- source-draft link copy. Deterministic locks cover exact current identities.
  FOR asset IN SELECT a.* FROM public.production_assets a WHERE a.organization_id = p_org AND a.id = ANY(production_ids)
    AND private.html_reconstruction_resource_eligible(a) ORDER BY a.id FOR SHARE
  LOOP
    bindings := bindings || jsonb_build_array(jsonb_build_object('origin','PRODUCTION','productionAssetId',asset.id,
      'checksum',asset.checksum,'fileSizeBytes',asset.file_size_bytes,'mimeType',asset.mime_type,
      'storageBucket',asset.storage_bucket,'storagePath',asset.storage_path));
  END LOOP;
  FOR asset IN SELECT a.* FROM public.organization_assembly_assets a WHERE a.organization_id = p_org AND a.id = ANY(brand_ids)
    AND a.status = 'APPROVED' AND a.mime_type IN ('video/mp4','video/webm') ORDER BY a.id FOR SHARE
  LOOP
    placements := '[]'::jsonb;
    IF p_selection#>>'{branding,introAssetId}' = asset.id::text THEN placements := placements || '["INTRO"]'::jsonb; END IF;
    IF p_selection#>>'{branding,outroAssetId}' = asset.id::text THEN placements := placements || '["OUTRO"]'::jsonb; END IF;
    bindings := bindings || jsonb_build_array(jsonb_build_object('origin','BRANDING','placements',placements,'productionAssetId',asset.id,
      'checksum',asset.checksum,'fileSizeBytes',asset.file_size_bytes,'mimeType',asset.mime_type,
      'storageBucket',asset.storage_bucket,'storagePath',asset.storage_path));
  END LOOP;
  FOR asset IN SELECT a.* FROM public.sound_effect_assets a WHERE a.organization_id = p_org AND a.id = ANY(sound_ids)
    AND a.status = 'READY' AND a.mime_type IN ('audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm') ORDER BY a.id FOR SHARE
  LOOP
    bindings := bindings || jsonb_build_array(jsonb_build_object('origin','SOUND_EFFECT','productionAssetId',asset.id,
      'checksum',asset.checksum_sha256,'fileSizeBytes',asset.file_size_bytes,'mimeType',asset.mime_type,
      'storageBucket',asset.storage_bucket,'storagePath',asset.storage_path));
  END LOOP;
  IF jsonb_array_length(bindings) <> cardinality(all_ids)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) b WHERE coalesce(b->>'checksum','') !~* '^[a-f0-9]{64}$'
      OR coalesce(b->>'fileSizeBytes','') !~ '^[0-9]{1,10}$'
      OR b->>'storageBucket' IS NULL OR b->>'storageBucket' NOT IN ('production-assets','production-render-sources','sound-effect-assets')
      OR b->>'storagePath' IS NULL OR length(b->>'storagePath') NOT BETWEEN 1 AND 1024
      OR b->>'storagePath' LIKE '/%' OR position('..' IN b->>'storagePath') > 0 OR position(chr(92) IN b->>'storagePath') > 0)
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTED_RESOURCES_FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) b WHERE (b->>'fileSizeBytes')::bigint NOT BETWEEN 1 AND 2147483648)
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTED_RESOURCES_FORBIDDEN'; END IF;
  RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION private.html_reconstruction_selected_bindings(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_html_reconstruction_selected_resources(p_org uuid,p_actor uuid,p_origin jsonb,p_selection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
BEGIN
  RETURN jsonb_build_object('origin',p_origin,'selection',p_selection,
    'bindings',private.html_reconstruction_selected_bindings(p_org,p_actor,p_origin,p_selection));
END $$;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_selected_resources(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_selected_resources(uuid,uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.validate_html_reconstruction_candidate(p_org uuid,p_actor uuid,p_staging jsonb,p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE content jsonb; proposed jsonb; document jsonb; manifest jsonb; archive jsonb; locator jsonb;
  initial jsonb; revision jsonb; binding jsonb; pointer jsonb; clip jsonb; grants jsonb; bindings jsonb; selection jsonb; expected_ids jsonb;
BEGIN
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,true);
  IF jsonb_typeof(p_candidate) IS DISTINCT FROM 'object' OR octet_length(p_candidate::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_INVALID'; END IF;
  content := p_candidate->'content'; proposed := content->'candidate'; document := proposed->'document';
  manifest := p_candidate#>'{registration,manifest}'; archive := p_candidate#>'{registration,archive}'; locator := p_staging#>'{review,locator}';
  IF p_candidate->>'scope' IS DISTINCT FROM 'RECONSTRUCTION_CANDIDATE_NOT_CREATED_OR_PUBLISHED'
    OR p_candidate->'review' IS DISTINCT FROM p_staging->'review'
    OR p_candidate->>'candidateSha256' IS DISTINCT FROM p_staging->>'candidateSha256'
    OR content->>'scope' IS DISTINCT FROM 'PREPARED_RECONSTRUCTED_ARCHIVE_NOT_APPROVED_CREATED_OR_PUBLISHED'
    OR proposed->>'scope' IS DISTINCT FROM 'PREPARED_NEW_CONTENT_NOT_HISTORICAL_REPUBLICATION_OR_APPROVAL'
    OR proposed->'origin' IS DISTINCT FROM p_staging#>'{review,origin}'
    OR proposed->'requiredReviews' IS DISTINCT FROM p_staging#>'{review,approval,completedReviews}'
    OR proposed#>>'{target,compositionId}' IS DISTINCT FROM locator->>'targetCompositionId'
    OR proposed#>>'{target,documentId}' IS DISTINCT FROM locator->>'targetDocumentId'
    OR proposed#>>'{target,revisionId}' IS DISTINCT FROM locator->>'targetRevisionId'
    OR document->>'format' IS DISTINCT FROM 'courseforge-composition-v4'
    OR (document->'deckStyles' IS DISTINCT FROM 'null'::jsonb AND (
      jsonb_typeof(document->'deckStyles') IS DISTINCT FROM 'object'
      OR jsonb_typeof(document#>'{deckStyles,css}') IS DISTINCT FROM 'string'
      OR octet_length(document#>>'{deckStyles,css}') > 256000
      OR document#>'{deckStyles,fontUrls}' IS DISTINCT FROM '[]'::jsonb))
    OR coalesce(proposed->>'documentHash','') !~ '^[a-f0-9]{64}$'
    OR content#>>'{prepared,documentHash}' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest->>'draft_document_hash' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest->>'draft_document_id' IS DISTINCT FROM locator->>'targetDocumentId'
    OR manifest->'snapshot' IS DISTINCT FROM 'true'::jsonb
    OR manifest->'conformance_contract_version' IS DISTINCT FROM '4'::jsonb
    OR manifest#>>'{conformance_contract,schemaVersion}' IS DISTINCT FROM '4'
    OR manifest#>>'{conformance_contract,documentHash}' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest#>>'{conformance_contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR content#>>'{prepared,projectHash}' IS DISTINCT FROM locator->>'projectHash'
    OR archive->>'projectHash' IS DISTINCT FROM locator->>'projectHash'
    OR archive->>'sizeBytes' IS DISTINCT FROM p_staging->>'archiveSizeBytes'
    OR archive->>'storageBucket' IS DISTINCT FROM 'production-assets'
    OR archive->>'storagePath' IS DISTINCT FROM 'composition-snapshots/'||p_org::text||'/'||
      (locator->>'targetCompositionId')||'/'||(locator->>'projectHash')||'.zip'
    OR manifest->'asset_manifest' IS DISTINCT FROM content#>'{prepared,assets}'
    OR manifest->'font_manifest' IS DISTINCT FROM content#>'{prepared,fontManifest}'
    OR manifest->'conformance_contract' IS DISTINCT FROM content#>'{prepared,contract}'
    OR manifest->'conformance_reference' IS DISTINCT FROM content#>'{prepared,metadata}'
    OR manifest->'html_editing_snapshot' IS DISTINCT FROM content#>'{prepared,metadata,htmlEditingSnapshot}'
    OR manifest#>>'{html_editing_snapshot,sha256}' IS DISTINCT FROM content#>>'{prepared,bundle,sha256}'
    OR manifest#>>'{html_editing_snapshot,path}' IS DISTINCT FROM 'html-editing-revisions.json'
    OR jsonb_typeof(document->'clips') IS DISTINCT FROM 'array'
    OR jsonb_typeof(document#>'{htmlEditing,items}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(proposed->'initialRevisions') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_INVALID'; END IF;
  IF jsonb_array_length(proposed->'initialRevisions') NOT BETWEEN 1 AND 200
    OR jsonb_array_length(proposed->'initialRevisions') <> jsonb_array_length(document#>'{htmlEditing,items}')
    OR jsonb_array_length(proposed->'initialRevisions') <> (SELECT count(DISTINCT e->>'clipId') FROM jsonb_array_elements(proposed->'initialRevisions') e)
    OR jsonb_array_length(proposed->'initialRevisions') <> (SELECT count(*) FROM jsonb_array_elements(document->'clips') c WHERE c#>>'{source,type}' = 'DECK_SLIDE')
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_POINTERS_INVALID'; END IF;
  selection := proposed#>'{target,resourceSelection}';
  IF selection IS NULL THEN
    bindings := private.html_snapshot_resource_bindings(p_org,(locator->>'sourceDraftId')::uuid,manifest->'asset_manifest',manifest->'font_manifest');
  ELSE
    bindings := private.html_reconstruction_selected_bindings(p_org,p_actor,proposed->'origin',selection);
    IF jsonb_array_length(bindings) <> jsonb_array_length(manifest->'asset_manifest')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(manifest->'asset_manifest') supplied
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) current
          WHERE current - 'origin' - 'placements' = supplied))
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTED_IDENTITY_CHANGED'; END IF;
    -- Font authority remains the existing tenant READY uploaded-byte policy.
    PERFORM private.html_snapshot_resource_bindings(p_org,(locator->>'sourceDraftId')::uuid,'[]'::jsonb,manifest->'font_manifest');
    SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO expected_ids FROM (
      SELECT DISTINCT used.value AS id FROM jsonb_array_elements(proposed->'initialRevisions') r,
        jsonb_array_elements_text(r->'usedAssetIds') used(value)
      UNION SELECT DISTINCT c#>>'{source,productionAssetId}' FROM jsonb_array_elements(document->'clips') c
        WHERE c#>>'{source,type}' = 'PRODUCTION_ASSET'
    ) referenced;
    IF expected_ids IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb)
        FROM jsonb_array_elements_text(selection->'productionAssetIds'))
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_SET_MISMATCH'; END IF;
    SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO expected_ids FROM (
      SELECT DISTINCT c#>>'{source,soundEffectAssetId}' AS id FROM jsonb_array_elements(document->'clips') c
        WHERE c#>>'{source,type}' = 'SOUND_EFFECT_ASSET'
    ) referenced;
    IF expected_ids IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb)
        FROM jsonb_array_elements_text(selection->'soundEffectAssetIds'))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(document->'clips') c WHERE c#>>'{source,type}' = 'ASSEMBLY_BRAND_ASSET'
        AND (c#>>'{source,placement}' NOT IN ('INTRO','OUTRO') OR c#>>'{source,assemblyBrandAssetId}' IS DISTINCT FROM
          CASE WHEN c#>>'{source,placement}' = 'INTRO' THEN selection#>>'{branding,introAssetId}' ELSE selection#>>'{branding,outroAssetId}' END))
      OR (selection#>>'{branding,introAssetId}' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'clips') c
        WHERE c#>>'{source,type}' = 'ASSEMBLY_BRAND_ASSET' AND c#>>'{source,placement}' = 'INTRO'))
      OR (selection#>>'{branding,outroAssetId}' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(document->'clips') c
        WHERE c#>>'{source,type}' = 'ASSEMBLY_BRAND_ASSET' AND c#>>'{source,placement}' = 'OUTRO'))
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SELECTION_SET_MISMATCH'; END IF;
  END IF;
  FOR initial IN SELECT e FROM jsonb_array_elements(proposed->'initialRevisions') e LOOP
    revision := initial->'revision'; binding := revision#>'{manifest,binding}';
    SELECT e INTO pointer FROM jsonb_array_elements(document#>'{htmlEditing,items}') e WHERE e->>'clipId' = initial->>'clipId';
    SELECT e INTO clip FROM jsonb_array_elements(document->'clips') e WHERE e->>'id' = initial->>'clipId';
    IF pointer IS NULL OR clip IS NULL OR clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE'
      OR clip#>>'{source,html}' IS DISTINCT FROM revision->>'sourceHtml'
      OR revision->>'format' IS DISTINCT FROM 'courseforge-html-editable-revision-v1'
      OR revision->'version' IS DISTINCT FROM '1'::jsonb OR revision#>'{state,overrides}' IS DISTINCT FROM '[]'::jsonb
      OR revision#>'{state,binding}' IS DISTINCT FROM binding OR octet_length(revision::text) > 1048576
      OR binding->>'organizationId' IS DISTINCT FROM p_org::text
      OR binding->>'documentId' IS DISTINCT FROM locator->>'targetDocumentId'
      OR binding->>'revisionId' IS DISTINCT FROM locator->>'targetRevisionId'
      OR binding->>'clipId' IS DISTINCT FROM initial->>'clipId'
      OR pointer->>'revisionSha256' IS DISTINCT FROM initial->>'revisionSha256'
      OR pointer->'revisionVersion' IS DISTINCT FROM '1'::jsonb
      OR pointer->>'templateId' IS DISTINCT FROM binding->>'templateId'
      OR pointer->'templateVersion' IS DISTINCT FROM binding->'templateVersion'
      OR pointer->>'sourceSha256' IS DISTINCT FROM binding->>'sourceSha256'
      OR pointer->>'manifestSha256' IS DISTINCT FROM binding->>'manifestSha256'
      OR jsonb_typeof(initial->'usedAssetIds') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_POINTERS_INVALID'; END IF;
    IF selection IS NULL THEN grants := private.html_editing_grants(p_org,(locator->>'sourceDraftId')::uuid,revision);
    ELSE SELECT coalesce(jsonb_agg(b->>'productionAssetId'),'[]'::jsonb) INTO grants FROM jsonb_array_elements(bindings) b
      WHERE b->>'origin' = 'PRODUCTION' AND b->>'mimeType' IN ('image/png','image/jpeg','image/webp')
        AND (b->>'fileSizeBytes')::bigint <= 33554432;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(initial->'usedAssetIds') used(id) WHERE NOT (grants ? used.id)
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) b WHERE b->>'productionAssetId' = used.id
        AND b->>'origin' = 'PRODUCTION' AND b->>'mimeType' IN ('image/png','image/jpeg','image/webp')))
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_HTML_GRANT_REVOKED'; END IF;
  END LOOP;
  RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION private.validate_html_reconstruction_candidate(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.link_html_reconstruction_resources(p_org uuid,p_actor uuid,p_draft uuid,p_revision uuid,
  p_source_draft uuid,p_bindings jsonb,p_html_used jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE binding jsonb;
BEGIN
  FOR binding IN SELECT e FROM jsonb_array_elements(p_bindings) e LOOP
    IF binding->>'origin' = 'PRODUCTION' THEN
      INSERT INTO public.video_composition_draft_assets(draft_id,production_asset_id,organization_id,role,source_reference)
        VALUES(p_draft,(binding->>'productionAssetId')::uuid,p_org,
          CASE WHEN binding->>'mimeType' LIKE 'audio/%' THEN 'AUDIO' WHEN binding->>'mimeType' LIKE 'video/%' THEN 'VIDEO' ELSE 'IMAGE' END,
          CASE WHEN p_html_used ? (binding->>'productionAssetId') THEN 'DECK_DEPENDENCY' ELSE 'HTML_RECONSTRUCTION' END);
      INSERT INTO public.video_composition_assets(composition_revision_id,organization_id,production_asset_id,role,
        source_checksum,source_storage_path,file_size_bytes,mime_type)
        VALUES(p_revision,p_org,(binding->>'productionAssetId')::uuid,
          CASE WHEN binding->>'mimeType' LIKE 'audio/%' THEN 'AUDIO' WHEN binding->>'mimeType' LIKE 'video/%' THEN 'VIDEO' ELSE 'IMAGE' END,
          binding->>'checksum',binding->>'storagePath',(binding->>'fileSizeBytes')::bigint,binding->>'mimeType');
    ELSIF binding->>'origin' = 'BRANDING' THEN
      INSERT INTO public.video_composition_brand_assets(composition_revision_id,organization_id,organization_assembly_asset_id,role,
        source_checksum,source_storage_bucket,source_storage_path,file_size_bytes,mime_type)
        VALUES(p_revision,p_org,(binding->>'productionAssetId')::uuid,'VIDEO',binding->>'checksum',binding->>'storageBucket',
          binding->>'storagePath',(binding->>'fileSizeBytes')::bigint,binding->>'mimeType');
    ELSIF binding->>'origin' = 'SOUND_EFFECT' THEN
      INSERT INTO public.video_composition_draft_sound_effect_assets(draft_id,sound_effect_asset_id,organization_id)
        VALUES(p_draft,(binding->>'productionAssetId')::uuid,p_org);
      INSERT INTO public.video_composition_sound_effect_assets(composition_revision_id,organization_id,sound_effect_asset_id,
        source_checksum,source_storage_path,file_size_bytes,mime_type)
        VALUES(p_revision,p_org,(binding->>'productionAssetId')::uuid,binding->>'checksum',binding->>'storagePath',
          (binding->>'fileSizeBytes')::bigint,binding->>'mimeType');
    ELSE RAISE EXCEPTION 'HTML_RECONSTRUCTION_RESOURCE_INVALID'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING') THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING' AND b ? 'placements') THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING' AND NOT (b ? 'placements'))
        OR (SELECT count(*) FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING' AND b->'placements' ? 'INTRO') > 1
        OR (SELECT count(*) FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING' AND b->'placements' ? 'OUTRO') > 1
        THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_BRANDING_UNAVAILABLE'; END IF;
      INSERT INTO public.video_composition_draft_branding(draft_id,organization_id,intro_asset_id,outro_asset_id,intro_source,resolved_at,resolved_by)
        VALUES(p_draft,p_org,
          (SELECT (b->>'productionAssetId')::uuid FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING' AND b->'placements' ? 'INTRO'),
          (SELECT (b->>'productionAssetId')::uuid FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING' AND b->'placements' ? 'OUTRO'),
          'ASSEMBLY_OVERRIDE',now(),p_actor);
    ELSE
    INSERT INTO public.video_composition_draft_branding(draft_id,organization_id,intro_asset_id,outro_asset_id,intro_source,resolved_at,resolved_by)
      SELECT p_draft,p_org,
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING'
          AND b->>'productionAssetId' = source.intro_asset_id::text) THEN source.intro_asset_id END,
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(p_bindings) b WHERE b->>'origin' = 'BRANDING'
          AND b->>'productionAssetId' = source.outro_asset_id::text) THEN source.outro_asset_id END,
        'ASSEMBLY_OVERRIDE',now(),p_actor FROM public.video_composition_draft_branding source
        WHERE source.draft_id = p_source_draft AND source.organization_id = p_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_BRANDING_UNAVAILABLE'; END IF;
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.link_html_reconstruction_resources(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

