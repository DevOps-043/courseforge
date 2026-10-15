-- PREPARED ONLY. Requires isolated reconstruction creation migration.
-- Current opening identity only: no native/HTML source or Storage address export.
BEGIN;
CREATE UNIQUE INDEX composition_html_reconstruction_creations_draft_identity
  ON private.composition_html_reconstruction_creations(organization_id,draft_id);

CREATE FUNCTION public.read_html_reconstruction_opening(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE draft public.video_composition_drafts%ROWTYPE; composition public.video_compositions%ROWTYPE;
  creation private.composition_html_reconstruction_creations%ROWTYPE; current_hash text; current_version integer;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPENING_INVALID'; END IF;
  -- Same draft-first/current membership authorization order as HTML readers.
  SELECT * INTO draft FROM public.video_composition_drafts WHERE id = p_draft
    AND organization_id = p_org AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPENING_UNAVAILABLE'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO composition FROM public.video_compositions WHERE id = p_composition
    AND organization_id = p_org AND status <> 'ARCHIVED' AND material_component_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPENING_UNAVAILABLE'; END IF;
  -- Creation evidence proves identity/provenance, NOT current grants or content.
  SELECT * INTO creation FROM private.composition_html_reconstruction_creations
    WHERE organization_id = p_org AND draft_id = p_draft AND composition_id = p_composition FOR SHARE;
  IF NOT FOUND OR draft.source_manifest->'htmlReconstruction' IS DISTINCT FROM creation.receipt#>'{staging,review}'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPENING_UNAVAILABLE'; END IF;
  SELECT d.document_hash,d.version INTO current_hash,current_version FROM public.video_composition_draft_documents d
    WHERE d.organization_id = p_org AND d.draft_id = p_draft ORDER BY d.version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR current_version IS DISTINCT FROM draft.current_version OR coalesce(current_hash,'') !~ '^[a-f0-9]{64}$'
    OR coalesce(creation.receipt->>'documentHash','') !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_OPENING_UNAVAILABLE'; END IF;
  RETURN jsonb_build_object('scope','AUTHORIZED_RECONSTRUCTION_OPENING_NOT_DOCUMENT_OR_PUBLICATION',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,'candidateId',creation.candidate_id,
    'operationId',creation.operation_id,'seedRevisionId',creation.revision_id,'seedDocumentHash',creation.receipt->>'documentHash',
    'currentDocumentHash',current_hash,'currentVersion',current_version,'materialComponentId',NULL,
    'activeRevisionId',composition.active_revision_id);
END $$;
REVOKE ALL ON FUNCTION public.read_html_reconstruction_opening(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_reconstruction_opening(uuid,uuid,uuid,uuid) TO service_role;
COMMIT;
