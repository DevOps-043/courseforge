-- PREPARED ONLY. Requires assert_html_editing_actor and html_snapshot_resource_bindings.
-- No changes to legacy snapshot activation, draft content, template stores or worker.
BEGIN;
CREATE FUNCTION public.read_initial_html_editing_anchor(p_org uuid,p_actor uuid,p_draft uuid,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE draft public.video_composition_drafts%ROWTYPE; native public.video_composition_draft_documents%ROWTYPE;
  composition public.video_compositions%ROWTYPE;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_draft IS NULL OR p_expected_hash IS NULL
    OR p_expected_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_INVALID'; END IF;
  SELECT * INTO draft FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO native FROM public.video_composition_draft_documents WHERE draft_id = p_draft AND organization_id = p_org
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR native.document_hash IS DISTINCT FROM p_expected_hash THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_CONFLICT'; END IF;
  SELECT * INTO composition FROM public.video_compositions WHERE id = draft.composition_id AND organization_id = p_org
    AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_FORBIDDEN'; END IF;
  IF composition.active_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.video_composition_revisions
    WHERE id = composition.active_revision_id AND organization_id = p_org AND composition_id = composition.id)
    THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_FORBIDDEN'; END IF;
  RETURN jsonb_build_object('documentId',p_draft,'compositionId',composition.id,
    'documentHash',native.document_hash,'activeRevisionId',composition.active_revision_id);
END $$;

CREATE FUNCTION public.activate_initial_html_editing_anchor(p_org uuid,p_actor uuid,p_draft uuid,p_expected_hash text,p_revision uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE draft public.video_composition_drafts%ROWTYPE; native public.video_composition_draft_documents%ROWTYPE;
  composition public.video_compositions%ROWTYPE; revision public.video_composition_revisions%ROWTYPE;
  bindings jsonb; binding jsonb;
BEGIN
  IF p_expected_hash IS NULL OR p_expected_hash !~ '^[a-f0-9]{64}$' OR p_revision IS NULL
    THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_INVALID'; END IF;
  -- Match native append/template revoke lock order. No locks held during ZIP work.
  SELECT * INTO draft FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO native FROM public.video_composition_draft_documents WHERE draft_id = p_draft AND organization_id = p_org
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR native.document_hash IS DISTINCT FROM p_expected_hash
    OR jsonb_array_length(coalesce(native.document#>'{htmlEditing,items}','[]'::jsonb)) <> 0
    THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_CONFLICT'; END IF;
  SELECT * INTO composition FROM public.video_compositions WHERE id = draft.composition_id AND organization_id = p_org
    AND status <> 'ARCHIVED' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_FORBIDDEN'; END IF;
  IF composition.active_revision_id IS NOT NULL THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_CONFLICT'; END IF;
  SELECT * INTO revision FROM public.video_composition_revisions WHERE id = p_revision AND organization_id = p_org
    AND composition_id = composition.id FOR SHARE;
  IF NOT FOUND OR revision.manifest->>'snapshot' IS DISTINCT FROM 'true'
    OR revision.manifest->>'draft_document_id' IS DISTINCT FROM p_draft::text
    OR revision.manifest->>'draft_document_hash' IS DISTINCT FROM p_expected_hash
    OR revision.project_hash IS NULL OR revision.project_hash !~ '^[a-f0-9]{64}$'
    OR revision.project_storage_bucket IS DISTINCT FROM 'production-assets'
    OR revision.project_storage_path IS DISTINCT FROM 'composition-snapshots/' || p_org::text || '/' || composition.id::text || '/' || revision.project_hash || '.zip'
    OR revision.project_archive_size_bytes IS NULL OR revision.project_archive_size_bytes NOT BETWEEN 1 AND 209715200
    THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_INVALID'; END IF;
  -- Revalidate current tenant grants/identities inside the activation transaction.
  bindings := private.html_snapshot_resource_bindings(p_org,p_draft,revision.manifest->'asset_manifest',revision.manifest->'font_manifest');
  FOR binding IN SELECT e FROM jsonb_array_elements(bindings) e LOOP
    IF binding->>'origin' = 'PRODUCTION' AND NOT EXISTS (SELECT 1 FROM public.video_composition_assets
      WHERE composition_revision_id = p_revision AND organization_id = p_org AND production_asset_id = (binding->>'productionAssetId')::uuid
        AND source_checksum = binding->>'checksum' AND source_storage_path = binding->>'storagePath'
        AND file_size_bytes = (binding->>'fileSizeBytes')::bigint AND mime_type = binding->>'mimeType')
      THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_INVALID'; END IF;
    IF binding->>'origin' = 'BRANDING' AND NOT EXISTS (SELECT 1 FROM public.video_composition_brand_assets
      WHERE composition_revision_id = p_revision AND organization_id = p_org AND organization_assembly_asset_id = (binding->>'productionAssetId')::uuid
        AND source_checksum = binding->>'checksum' AND source_storage_path = binding->>'storagePath'
        AND source_storage_bucket = binding->>'storageBucket' AND file_size_bytes = (binding->>'fileSizeBytes')::bigint AND mime_type = binding->>'mimeType')
      THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_INVALID'; END IF;
    IF binding->>'origin' = 'SOUND_EFFECT' AND NOT EXISTS (SELECT 1 FROM public.video_composition_sound_effect_assets
      WHERE composition_revision_id = p_revision AND organization_id = p_org AND sound_effect_asset_id = (binding->>'productionAssetId')::uuid
        AND source_checksum = binding->>'checksum' AND source_storage_path = binding->>'storagePath'
        AND source_storage_bucket = binding->>'storageBucket' AND file_size_bytes = (binding->>'fileSizeBytes')::bigint AND mime_type = binding->>'mimeType')
      THEN RAISE EXCEPTION 'HTML_INITIAL_ANCHOR_INVALID'; END IF;
  END LOOP;
  UPDATE public.video_compositions SET active_revision_id = p_revision,status = 'READY_FOR_PREVIEW',updated_at = now()
    WHERE id = composition.id AND organization_id = p_org;
END $$;
REVOKE ALL ON FUNCTION public.read_initial_html_editing_anchor(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.activate_initial_html_editing_anchor(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_initial_html_editing_anchor(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_initial_html_editing_anchor(uuid,uuid,uuid,text,uuid) TO service_role;
COMMIT;
