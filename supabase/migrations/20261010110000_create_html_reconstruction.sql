-- PREPARED ONLY. Requires reconstruction candidate/review/resource migrations.
-- No migration application, template activation, rendering or publication.
BEGIN;
CREATE TABLE private.composition_html_reconstruction_creations (
  organization_id uuid NOT NULL, operation_id uuid NOT NULL,
  candidate_id uuid NOT NULL, reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id),
  receipt jsonb NOT NULL CHECK (octet_length(receipt::text) <= 4096), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,operation_id), UNIQUE(organization_id,candidate_id),
  FOREIGN KEY(organization_id,operation_id) REFERENCES private.composition_html_reconstruction_staging(organization_id,operation_id)
);
ALTER TABLE private.composition_html_reconstruction_creations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_reconstruction_creations FROM PUBLIC,anon,authenticated,service_role;

-- New-resource links only, from freshly locked identities. Do not copy unrelated
-- links, defaults, branding snapshots, source manifests or permissions from ZIP.
CREATE FUNCTION private.link_html_reconstruction_resources(p_org uuid,p_actor uuid,p_draft uuid,p_revision uuid,
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
END $$;
REVOKE ALL ON FUNCTION private.link_html_reconstruction_resources(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_html_reconstruction_creation(p_org uuid,p_actor uuid,p_staging jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE stored private.composition_html_reconstruction_creations%ROWTYPE;
BEGIN
  -- Historical receipt remains readable after review withdrawal/resource changes.
  -- Still require current actor/source access, not caller metadata as authority.
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,false);
  SELECT * INTO stored FROM private.composition_html_reconstruction_creations WHERE organization_id = p_org
    AND operation_id = (p_staging->>'operationId')::uuid FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF stored.reviewer_id IS DISTINCT FROM p_actor OR stored.receipt->'staging' IS DISTINCT FROM p_staging
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPERATION_CONFLICT'; END IF;
  RETURN jsonb_build_object('status','RECORDED','receipt',stored.receipt);
END $$;

CREATE FUNCTION public.create_html_reconstruction(p_org uuid,p_actor uuid,p_staging jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE previous private.composition_html_reconstruction_creations%ROWTYPE; staged private.composition_html_reconstruction_staging%ROWTYPE;
  candidate jsonb; proposed jsonb; document jsonb; manifest jsonb; archive jsonb; locator jsonb; bindings jsonb; initial jsonb;
  source_composition public.video_compositions%ROWTYPE; new_composition uuid; new_draft uuid; new_revision uuid; receipt jsonb;
BEGIN
  -- Draft-first authorization, then serialize this journal identity. An uncertain
  -- prior commit can only return its receipt, never overwrite/adopt targets.
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,false);
  SELECT * INTO staged FROM private.composition_html_reconstruction_staging WHERE organization_id = p_org
    AND operation_id = (p_staging->>'operationId')::uuid FOR UPDATE NOWAIT;
  IF NOT FOUND OR staged.reviewer_id IS DISTINCT FROM p_actor OR staged.staging IS DISTINCT FROM p_staging
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_STAGING_REQUIRED'; END IF;
  SELECT * INTO previous FROM private.composition_html_reconstruction_creations WHERE organization_id = p_org AND operation_id = staged.operation_id;
  IF FOUND THEN
    IF previous.receipt->'staging' IS DISTINCT FROM p_staging OR previous.reviewer_id IS DISTINCT FROM p_actor
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPERATION_CONFLICT'; END IF;
    RETURN previous.receipt;
  END IF;
  SELECT c.candidate INTO candidate FROM private.composition_html_reconstruction_candidates c
    WHERE c.organization_id = p_org AND c.operation_id = staged.operation_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_UNAVAILABLE'; END IF;
  bindings := private.validate_html_reconstruction_candidate(p_org,p_actor,p_staging,candidate);
  proposed := candidate#>'{content,candidate}'; document := proposed->'document';
  manifest := candidate#>'{registration,manifest}'; archive := candidate#>'{registration,archive}'; locator := p_staging#>'{review,locator}';
  new_composition := (locator->>'targetCompositionId')::uuid; new_draft := (locator->>'targetDocumentId')::uuid;
  new_revision := (locator->>'targetRevisionId')::uuid;
  SELECT * INTO source_composition FROM public.video_compositions WHERE id = (locator->>'sourceCompositionId')::uuid
    AND organization_id = p_org AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SOURCE_UNAVAILABLE'; END IF;
  PERFORM 1 FROM public.artifacts WHERE id = source_composition.artifact_id AND organization_id = p_org FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_SOURCE_UNAVAILABLE'; END IF;
  -- Plain inserts enforce global UUID absence as well as tenant isolation. No
  -- ON CONFLICT/UPSERT against content tables, no original component reassignment.
  INSERT INTO public.video_compositions(id,organization_id,artifact_id,material_component_id,name,status,active_revision_id,created_by)
    VALUES(new_composition,p_org,source_composition.artifact_id,NULL,'Reconstrucción HTML','DRAFT',NULL,p_actor);
  INSERT INTO public.video_composition_drafts(id,composition_id,organization_id,state,current_version,
    project_storage_bucket,project_storage_prefix,source_manifest,last_changed_by)
    VALUES(new_draft,new_composition,p_org,'ACTIVE',1,'production-assets','video-composition-drafts/'||p_org::text||'/'||new_composition::text,
      jsonb_build_object('documentFormat','courseforge-composition-v4','version',1,'htmlReconstruction',p_staging->'review'),p_actor);
  -- Keep the approved registration manifest exact: normal explicit publication
  -- may reuse this same project hash. Extra manifest keys would cause a reuse
  -- conflict. Provenance stays in draft.source_manifest + immutable creation audit.
  INSERT INTO public.video_composition_revisions(id,composition_id,organization_id,revision_number,generation_mode,format,entry_point,
    project_storage_bucket,project_storage_path,project_archive_size_bytes,project_hash,variables_schema,variables_values,manifest,created_by)
    VALUES(new_revision,new_composition,p_org,1,'AUTOMATIC','hyperframes-html-v1','index.html',archive->>'storageBucket',archive->>'storagePath',
      (archive->>'sizeBytes')::bigint,archive->>'projectHash','[]'::jsonb,document->'variables',manifest,p_actor);
  -- Initial HTML bindings are already approved producer content. Generic bootstrap
  -- cannot be called here: it requires the pointer-less base as a saved latest row.
  -- This isolated creation stores the FINAL approved native document at version 1;
  -- original immutable binding/base hash remains unchanged and separately traced.
  INSERT INTO public.video_composition_draft_documents(draft_id,organization_id,version,format,document,document_hash,created_by)
    VALUES(new_draft,p_org,1,'courseforge-composition-v4',document,proposed->>'documentHash',p_actor);
  FOR initial IN SELECT e FROM jsonb_array_elements(proposed->'initialRevisions') e LOOP
    INSERT INTO private.composition_html_templates(organization_id,draft_id,clip_id,initial_revision)
      VALUES(p_org,new_draft,initial->>'clipId',initial->'revision');
    INSERT INTO private.composition_html_revisions(organization_id,draft_id,clip_id,version,revision,sha256,created_by)
      VALUES(p_org,new_draft,initial->>'clipId',1,initial->'revision',initial->>'revisionSha256',p_actor);
  END LOOP;
  PERFORM private.link_html_reconstruction_resources(p_org,p_actor,new_draft,new_revision,(locator->>'sourceDraftId')::uuid,
    bindings,candidate#>'{registration,htmlUsedAssetIds}');
  -- Validate the NEW saved pointer/link set through the existing exact reader.
  -- This is SQL identity acquisition, not compilation of historical source.
  PERFORM public.read_html_editing_compilation(p_org,new_draft,p_actor,proposed->>'documentHash');
  INSERT INTO public.video_composition_draft_changes(draft_id,organization_id,version,actor_id,source,summary,metadata)
    VALUES(new_draft,p_org,1,p_actor,'SYSTEM','Creó contenido reconstruido independiente.',jsonb_build_object('htmlReconstruction',p_staging->'review'));
  receipt := jsonb_build_object('scope','RECONSTRUCTION_CREATION_RECEIPT_NOT_PUBLICATION_OR_CURRENT_STATE','staging',p_staging,
    'documentHash',proposed->>'documentHash','nativeVersion',1,'activated',false,'originalDraftChanged',false,'materialComponentId',NULL);
  INSERT INTO private.composition_html_reconstruction_creations(organization_id,operation_id,candidate_id,reviewer_id,composition_id,draft_id,revision_id,receipt)
    VALUES(p_org,staged.operation_id,staged.candidate_id,p_actor,new_composition,new_draft,new_revision,receipt);
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_creation(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_html_reconstruction(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_creation(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_html_reconstruction(uuid,uuid,jsonb) TO service_role;
COMMENT ON TABLE private.composition_html_reconstruction_creations IS
  'Create-only isolated new composition/draft/native/HTML/resource lineage receipts. Not activation, original edits or publication.';
COMMIT;
