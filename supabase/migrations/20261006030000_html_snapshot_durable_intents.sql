-- PREPARED ONLY. Locator precedes Storage; recorded intent is not commit proof.
BEGIN;
CREATE FUNCTION public.record_html_editing_snapshot_intent(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_operation uuid,p_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_snapshot_intents%ROWTYPE; composition public.video_compositions%ROWTYPE; native_hash text;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL OR p_operation IS NULL
    OR p_intent IS NULL OR octet_length(p_intent::text) > 4096 OR p_intent->>'status' IS DISTINCT FROM 'RECORDED'
    OR p_intent#>>'{identity,organizationId}' IS DISTINCT FROM p_org::text
    OR p_intent#>>'{identity,compositionId}' IS DISTINCT FROM p_composition::text
    OR p_intent#>>'{identity,draftId}' IS DISTINCT FROM p_draft::text
    OR p_intent#>>'{identity,operationId}' IS DISTINCT FROM p_operation::text
    OR p_intent#>>'{identity,documentHash}' IS NULL OR p_intent#>>'{identity,documentHash}' !~ '^[a-f0-9]{64}$'
    OR p_intent#>>'{identity,projectHash}' IS NULL OR p_intent#>>'{identity,projectHash}' !~ '^[a-f0-9]{64}$'
    OR p_intent->>'archiveSizeBytes' IS NULL OR p_intent->>'archiveSizeBytes' !~ '^[0-9]{1,9}$'
    OR (p_intent->>'archiveSizeBytes')::bigint NOT BETWEEN 1 AND 209715200
    OR NOT (p_intent ? 'expectedActiveRevisionId') THEN RAISE EXCEPTION 'HTML_SNAPSHOT_INTENT_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_DRAFT_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO composition FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_COMPOSITION_FORBIDDEN'; END IF;
  SELECT document_hash INTO native_hash FROM public.video_composition_draft_documents WHERE draft_id = p_draft AND organization_id = p_org
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF native_hash IS DISTINCT FROM p_intent#>>'{identity,documentHash}'
    OR coalesce(to_jsonb(composition.active_revision_id),'null'::jsonb) IS DISTINCT FROM p_intent->'expectedActiveRevisionId'
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_CAS_CONFLICT'; END IF;
  PERFORM public.read_html_editing_compilation(p_org,p_draft,p_actor,native_hash);
  INSERT INTO private.composition_html_snapshot_intents(organization_id,operation_id,composition_id,draft_id,actor_id,intent)
    VALUES(p_org,p_operation,p_composition,p_draft,p_actor,p_intent) ON CONFLICT (organization_id,operation_id) DO NOTHING;
  SELECT * INTO stored FROM private.composition_html_snapshot_intents WHERE organization_id = p_org AND operation_id = p_operation FOR SHARE;
  IF stored.actor_id IS DISTINCT FROM p_actor OR stored.composition_id IS DISTINCT FROM p_composition OR stored.draft_id IS DISTINCT FROM p_draft
    OR stored.intent IS DISTINCT FROM p_intent THEN RAISE EXCEPTION 'HTML_SNAPSHOT_OPERATION_CONFLICT'; END IF;
  RETURN stored.intent;
END $$;
CREATE FUNCTION public.read_html_editing_snapshot_intent(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_snapshot_intents%ROWTYPE;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_composition IS NULL OR p_draft IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'HTML_SNAPSHOT_INTENT_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft AND organization_id = p_org AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_DRAFT_FORBIDDEN'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  PERFORM 1 FROM public.video_compositions WHERE id = p_composition AND organization_id = p_org AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_SNAPSHOT_COMPOSITION_FORBIDDEN'; END IF;
  SELECT * INTO stored FROM private.composition_html_snapshot_intents WHERE organization_id = p_org AND operation_id = p_operation FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF stored.actor_id IS DISTINCT FROM p_actor OR stored.composition_id IS DISTINCT FROM p_composition OR stored.draft_id IS DISTINCT FROM p_draft
    THEN RAISE EXCEPTION 'HTML_SNAPSHOT_OPERATION_FORBIDDEN'; END IF;
  PERFORM public.read_html_editing_compilation(p_org,p_draft,p_actor,stored.intent#>>'{identity,documentHash}');
  RETURN stored.intent;
END $$;
REVOKE ALL ON FUNCTION public.record_html_editing_snapshot_intent(uuid,uuid,uuid,uuid,uuid,jsonb),
  public.read_html_editing_snapshot_intent(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_html_editing_snapshot_intent(uuid,uuid,uuid,uuid,uuid,jsonb),
  public.read_html_editing_snapshot_intent(uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON TABLE private.composition_html_snapshot_intents IS 'Prepared immutable operation locator before Storage; absence/intent is never upload/commit confirmation or retry authority. Retention must preserve recovery window.';
COMMIT;
