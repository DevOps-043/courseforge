-- PREPARED ONLY: no migration application, template registration or endpoint rollout.
BEGIN;
CREATE FUNCTION public.read_html_editing_bootstrap_context(p_organization_id uuid,p_draft_id uuid,p_clip_id text,
  p_actor_id uuid,p_expected_document_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE draft public.video_composition_drafts%ROWTYPE; d public.video_composition_draft_documents%ROWTYPE;
  anchor uuid; source_clip jsonb; grants jsonb := '[]'::jsonb; image record; result jsonb;
BEGIN
  IF p_expected_document_hash IS NULL OR p_expected_document_hash !~ '^[a-f0-9]{64}$'
    OR p_clip_id IS NULL OR p_clip_id !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'
    THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  SELECT * INTO draft FROM public.video_composition_drafts
    WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO d FROM public.video_composition_draft_documents
    WHERE draft_id = p_draft_id AND organization_id = p_organization_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR d.document_hash IS DISTINCT FROM p_expected_document_hash
    THEN RAISE EXCEPTION 'HTML_EDITING_REVISION_CONFLICT'; END IF;
  SELECT c INTO source_clip FROM jsonb_array_elements(d.document->'clips') c WHERE c->>'id' = p_clip_id;
  IF source_clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE' OR source_clip#>>'{source,type}' IS DISTINCT FROM 'DECK_SLIDE'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) ref WHERE ref->>'clipId' = p_clip_id)
    THEN RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID'; END IF;
  -- The active saved snapshot is an issuance anchor, not proof that its native
  -- document equals this later saved draft. document_hash identifies the draft.
  SELECT r.id INTO anchor FROM public.video_compositions c JOIN public.video_composition_revisions r ON r.id = c.active_revision_id
    WHERE c.id = draft.composition_id AND c.organization_id = p_organization_id
      AND r.composition_id = c.id AND r.organization_id = p_organization_id FOR SHARE OF c,r;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  FOR image IN SELECT a.id FROM public.video_composition_draft_assets l JOIN public.production_assets a ON a.id = l.production_asset_id
    WHERE l.draft_id = p_draft_id AND l.organization_id = p_organization_id AND a.organization_id = p_organization_id
      AND a.mime_type IN ('image/png','image/jpeg','image/webp') AND a.file_size_bytes BETWEEN 1 AND 33554432
      AND a.checksum ~ '^[a-f0-9]{64}$' AND a.storage_bucket IS NOT NULL AND a.storage_path IS NOT NULL
      AND a.qa_status IN ('GENERATED','READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
    ORDER BY a.id LIMIT 6401 FOR SHARE OF l,a
  LOOP
    grants := grants || jsonb_build_array(image.id::text);
    IF jsonb_array_length(grants) > 6400 THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  END LOOP;
  result := jsonb_build_object('organizationId',p_organization_id,'documentId',p_draft_id,'clipId',p_clip_id,
    'revisionId',anchor,'documentHash',d.document_hash,'document',d.document,'grantedAssetIds',grants);
  IF octet_length(result::text) > 16777216 THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_bootstrap_context(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_bootstrap_context(uuid,uuid,text,uuid,text) TO service_role;
COMMIT;
