-- PREPARED ONLY. Requires exact HTML reader + resource validator migrations.
-- Trusted host verifies full schemas/canonical native+HTML digests, used assets,
-- rebuilt V4 contract and Storage readback before invoking this service-only RPC.
BEGIN;
CREATE TABLE private.composition_html_snapshot_intents (
  organization_id uuid NOT NULL REFERENCES public.organizations(id), operation_id uuid NOT NULL,
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id), draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id), intent jsonb NOT NULL CHECK (octet_length(intent::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,operation_id)
);
ALTER TABLE private.composition_html_snapshot_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_snapshot_intents FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.composition_html_snapshot_operations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  operation_id uuid NOT NULL,
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id),
  request jsonb NOT NULL CHECK (octet_length(request::text) <= 16777216),
  acknowledgment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,operation_id)
);
ALTER TABLE private.composition_html_snapshot_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_snapshot_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.commit_html_editing_snapshot(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_operation uuid,p_expected_active uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE draft public.video_composition_drafts%ROWTYPE; composition public.video_compositions%ROWTYPE;
  native public.video_composition_draft_documents%ROWTYPE; revision public.video_composition_revisions%ROWTYPE;
  previous private.composition_html_snapshot_operations%ROWTYPE;
  exact_read jsonb; grants jsonb; bindings jsonb; binding jsonb; request jsonb; ack jsonb;
  manifest jsonb; archive jsonb; disposition text; next_number integer;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL OR p_operation IS NULL
    OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_INVALID'; END IF;
  archive := p_payload->'archive'; manifest := p_payload->'manifest';
  IF archive->>'projectHash' IS NULL OR archive->>'projectHash' !~ '^[a-f0-9]{64}$'
    OR archive->>'storageBucket' IS DISTINCT FROM 'production-assets'
    OR archive->>'storagePath' IS DISTINCT FROM 'composition-snapshots/' || p_org::text || '/' || p_composition::text || '/' || (archive->>'projectHash') || '.zip'
    OR archive->>'sizeBytes' IS NULL OR archive->>'sizeBytes' !~ '^[0-9]{1,9}$'
    OR (archive->>'sizeBytes')::bigint NOT BETWEEN 1 AND 209715200
    OR manifest->>'draft_document_id' IS DISTINCT FROM p_draft::text
    OR manifest->>'draft_document_hash' IS NULL OR manifest->>'draft_document_hash' !~ '^[a-f0-9]{64}$'
    OR manifest->>'snapshot' IS DISTINCT FROM 'true'
    OR manifest->>'conformance_contract_version' IS DISTINCT FROM '4'
    OR manifest#>>'{conformance_contract,documentHash}' IS DISTINCT FROM manifest->>'draft_document_hash'
    OR manifest#>>'{conformance_contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR manifest#>>'{html_editing_snapshot,path}' IS DISTINCT FROM 'html-editing-revisions.json'
    OR manifest#>>'{html_editing_snapshot,sha256}' IS NULL OR manifest#>>'{html_editing_snapshot,sha256}' !~ '^[a-f0-9]{64}$'
    OR manifest->'html_editing_snapshot' IS DISTINCT FROM manifest#>'{conformance_reference,htmlEditingSnapshot}'
    OR jsonb_typeof(p_payload->'htmlUsedAssetIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_payload->'htmlUsedAssetIds') > 250 THEN RAISE EXCEPTION 'HTML_SNAPSHOT_INVALID'; END IF;
  -- Draft-first matches native/HTML append and template revocation lock order.
  SELECT * INTO draft FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_DRAFT_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO composition FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org
    AND status <> 'ARCHIVED' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_COMPOSITION_FORBIDDEN'; END IF;
  exact_read := public.read_html_editing_compilation(p_org,p_draft,p_actor,manifest->>'draft_document_hash');
  SELECT coalesce(jsonb_agg(DISTINCT id),'[]'::jsonb) INTO grants FROM
    jsonb_array_elements(exact_read->'revisions') r, jsonb_array_elements_text(r->'grantedAssetIds') g(id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'htmlUsedAssetIds') u(id)
    WHERE NOT (grants ? u.id) OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(manifest->'asset_manifest') a
      WHERE a->>'productionAssetId' = u.id AND a->>'mimeType' IN ('image/png','image/jpeg','image/webp')))
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_HTML_GRANT_REVOKED'; END IF;
  bindings := private.html_snapshot_resource_bindings(p_org,p_draft,manifest->'asset_manifest',manifest->'font_manifest');
  PERFORM 1 FROM private.composition_html_snapshot_intents i WHERE i.organization_id = p_org AND i.operation_id = p_operation
    AND i.composition_id = p_composition AND i.draft_id = p_draft AND i.actor_id = p_actor
    AND i.intent#>>'{identity,documentHash}' = manifest->>'draft_document_hash'
    AND i.intent#>>'{identity,projectHash}' = archive->>'projectHash'
    AND i.intent->>'archiveSizeBytes' = archive->>'sizeBytes'
    AND i.intent->'expectedActiveRevisionId' = coalesce(to_jsonb(p_expected_active),'null'::jsonb) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_INTENT_UNCONFIRMED'; END IF;
  request := jsonb_build_object('actor',p_actor,'composition',p_composition,'draft',p_draft,
    'expectedActive',p_expected_active,'payload',p_payload);
  IF octet_length(request::text) > 16777216 THEN RAISE EXCEPTION 'HTML_SNAPSHOT_INVALID'; END IF;
  SELECT * INTO previous FROM private.composition_html_snapshot_operations WHERE organization_id = p_org AND operation_id = p_operation;
  IF FOUND THEN
    IF previous.request IS DISTINCT FROM request THEN RAISE EXCEPTION 'HTML_SNAPSHOT_OPERATION_CONFLICT'; END IF;
    PERFORM 1 FROM public.video_composition_revisions v WHERE v.id = previous.revision_id AND v.organization_id = p_org
      AND v.composition_id = p_composition AND v.manifest = manifest AND v.project_hash = archive->>'projectHash'
      AND v.project_storage_bucket = archive->>'storageBucket' AND v.project_storage_path = archive->>'storagePath'
      AND v.project_archive_size_bytes = (archive->>'sizeBytes')::bigint FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_REUSE_CONFLICT'; END IF;
    -- Reconcile only: never silently reactivate an old acknowledged revision.
    IF composition.active_revision_id IS DISTINCT FROM previous.revision_id THEN RAISE EXCEPTION 'HTML_SNAPSHOT_ACTIVE_CHANGED'; END IF;
    RETURN previous.acknowledgment;
  END IF;
  SELECT * INTO native FROM public.video_composition_draft_documents WHERE draft_id = p_draft AND organization_id = p_org
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF native.document_hash IS DISTINCT FROM manifest->>'draft_document_hash'
    OR composition.active_revision_id IS DISTINCT FROM p_expected_active THEN RAISE EXCEPTION 'HTML_SNAPSHOT_CAS_CONFLICT'; END IF;
  SELECT * INTO revision FROM public.video_composition_revisions WHERE composition_id = p_composition AND project_hash = archive->>'projectHash' FOR SHARE;
  IF FOUND THEN
    IF revision.organization_id IS DISTINCT FROM p_org OR revision.manifest IS DISTINCT FROM manifest
      OR revision.project_storage_bucket IS DISTINCT FROM archive->>'storageBucket'
      OR revision.project_storage_path IS DISTINCT FROM archive->>'storagePath'
      OR revision.project_archive_size_bytes IS DISTINCT FROM (archive->>'sizeBytes')::bigint
      THEN RAISE EXCEPTION 'HTML_SNAPSHOT_REUSE_CONFLICT'; END IF;
    disposition := 'REUSED';
  ELSE
    SELECT coalesce(max(revision_number),0) + 1 INTO next_number FROM public.video_composition_revisions WHERE composition_id = p_composition;
    INSERT INTO public.video_composition_revisions(composition_id,organization_id,revision_number,generation_mode,format,entry_point,
      project_storage_bucket,project_storage_path,project_archive_size_bytes,project_hash,variables_schema,variables_values,manifest,created_by)
    VALUES(p_composition,p_org,next_number,'AUTOMATIC','hyperframes-html-v1','index.html',archive->>'storageBucket',archive->>'storagePath',
      (archive->>'sizeBytes')::bigint,archive->>'projectHash','[]'::jsonb,coalesce(native.document->'variables','{}'::jsonb),manifest,p_actor)
    RETURNING * INTO revision;
    disposition := 'CREATED';
  END IF;
  -- Reuse repairs/checks provenance too, within this transaction. Conflicting
  -- existing link identities abort rather than treating DO NOTHING as proof.
  FOR binding IN SELECT e FROM jsonb_array_elements(bindings) e LOOP
    IF binding->>'origin' = 'PRODUCTION' THEN
      INSERT INTO public.video_composition_assets(composition_revision_id,organization_id,production_asset_id,role,source_checksum,source_storage_path,file_size_bytes,mime_type)
      VALUES(revision.id,p_org,(binding->>'productionAssetId')::uuid,CASE WHEN binding->>'mimeType' LIKE 'audio/%' THEN 'AUDIO'
        WHEN binding->>'mimeType' LIKE 'video/%' THEN 'VIDEO' ELSE 'IMAGE' END,binding->>'checksum',binding->>'storagePath',
        (binding->>'fileSizeBytes')::bigint,binding->>'mimeType') ON CONFLICT (composition_revision_id,production_asset_id) DO NOTHING;
      PERFORM 1 FROM public.video_composition_assets WHERE composition_revision_id = revision.id AND organization_id = p_org
        AND production_asset_id = (binding->>'productionAssetId')::uuid AND source_checksum = binding->>'checksum'
        AND source_storage_path = binding->>'storagePath' AND file_size_bytes = (binding->>'fileSizeBytes')::bigint AND mime_type = binding->>'mimeType' FOR SHARE;
    ELSIF binding->>'origin' = 'BRANDING' THEN
      INSERT INTO public.video_composition_brand_assets(composition_revision_id,organization_id,organization_assembly_asset_id,role,
        source_checksum,source_storage_bucket,source_storage_path,file_size_bytes,mime_type)
      VALUES(revision.id,p_org,(binding->>'productionAssetId')::uuid,'VIDEO',binding->>'checksum',binding->>'storageBucket',binding->>'storagePath',
        (binding->>'fileSizeBytes')::bigint,binding->>'mimeType') ON CONFLICT (composition_revision_id,organization_assembly_asset_id) DO NOTHING;
      PERFORM 1 FROM public.video_composition_brand_assets WHERE composition_revision_id = revision.id AND organization_id = p_org
        AND organization_assembly_asset_id = (binding->>'productionAssetId')::uuid AND source_checksum = binding->>'checksum'
        AND source_storage_bucket = binding->>'storageBucket' AND source_storage_path = binding->>'storagePath'
        AND file_size_bytes = (binding->>'fileSizeBytes')::bigint AND mime_type = binding->>'mimeType' FOR SHARE;
    ELSE
      INSERT INTO public.video_composition_sound_effect_assets(composition_revision_id,organization_id,sound_effect_asset_id,source_checksum,source_storage_path,file_size_bytes,mime_type)
      VALUES(revision.id,p_org,(binding->>'productionAssetId')::uuid,binding->>'checksum',binding->>'storagePath',
        (binding->>'fileSizeBytes')::bigint,binding->>'mimeType') ON CONFLICT (composition_revision_id,sound_effect_asset_id) DO NOTHING;
      PERFORM 1 FROM public.video_composition_sound_effect_assets WHERE composition_revision_id = revision.id AND organization_id = p_org
        AND sound_effect_asset_id = (binding->>'productionAssetId')::uuid AND source_checksum = binding->>'checksum'
        AND source_storage_path = binding->>'storagePath' AND file_size_bytes = (binding->>'fileSizeBytes')::bigint AND mime_type = binding->>'mimeType' FOR SHARE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_LINK_CONFLICT'; END IF;
  END LOOP;
  UPDATE public.video_compositions SET active_revision_id = revision.id,status = 'READY_FOR_PREVIEW',updated_at = now()
    WHERE id = p_composition AND organization_id = p_org;
  ack := jsonb_build_object('operationId',p_operation,'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,
    'documentHash',manifest->>'draft_document_hash','projectHash',archive->>'projectHash','revisionId',revision.id,
    'revisionNumber',revision.revision_number,'activeRevisionId',revision.id,'disposition',disposition);
  INSERT INTO private.composition_html_snapshot_operations(organization_id,operation_id,composition_id,draft_id,actor_id,revision_id,request,acknowledgment)
    VALUES(p_org,p_operation,p_composition,p_draft,p_actor,revision.id,request,ack);
  RETURN ack;
END $$;
REVOKE ALL ON FUNCTION public.commit_html_editing_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_html_editing_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMENT ON TABLE private.composition_html_snapshot_operations IS 'Prepared atomic publication audit/idempotency receipts. No direct service access; retention must preserve reconciliation window.';
COMMIT;
