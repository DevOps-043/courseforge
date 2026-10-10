-- PREPARED ONLY. Requires legacy candidate store (manual step14).
-- Historical registration recovery under CURRENT actor/draft authority; not
-- approval/current source/grants, catalogue installation or adoption authority.
BEGIN;
CREATE FUNCTION public.read_html_editing_legacy_registration(p_organization_id uuid,p_draft_id uuid,p_clip_id text,
  p_actor_id uuid,p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE candidate jsonb; revoked boolean; result jsonb;
BEGIN
  IF p_clip_id IS NULL OR p_clip_id !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$' OR p_candidate_id IS NULL
    THEN RAISE EXCEPTION 'HTML_LEGACY_REGISTRATION_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_REGISTRATION_UNAVAILABLE'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT c.candidate,c.revoked INTO candidate,revoked FROM private.composition_html_legacy_candidates c
    WHERE c.organization_id = p_organization_id AND c.draft_id = p_draft_id AND c.clip_id = p_clip_id
      AND c.candidate_id = p_candidate_id AND c.reviewed_by = p_actor_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  result := jsonb_build_object('status','RECORDED','candidate',candidate,'revoked',revoked);
  IF octet_length(result::text) > 4198400 THEN RAISE EXCEPTION 'HTML_LEGACY_REGISTRATION_UNAVAILABLE'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_legacy_registration(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_legacy_registration(uuid,uuid,text,uuid,uuid) TO service_role;
COMMIT;
