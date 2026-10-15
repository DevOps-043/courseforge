-- PREPARED ONLY: no application, history/endpoint activation or rollout.
BEGIN;
CREATE FUNCTION public.read_html_editing_restore_revision(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,
  p_restore_version integer,p_restore_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE current_context jsonb; historical private.composition_html_revisions%ROWTYPE;
BEGIN
  IF p_restore_version IS NULL OR p_restore_version NOT BETWEEN 1 AND 1000000
    OR p_restore_sha256 IS NULL OR p_restore_sha256 !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  -- Current authorized reader owns draft-root/actor/template-revocation/native
  -- reference checks and locks; its authority cannot come from a history locator.
  current_context := public.read_html_editing_revision(p_organization_id,p_draft_id,p_clip_id,p_actor_id);
  SELECT * INTO historical FROM private.composition_html_revisions
    WHERE organization_id = p_organization_id AND draft_id = p_draft_id AND clip_id = p_clip_id
      AND version = p_restore_version AND sha256 = p_restore_sha256 FOR SHARE;
  IF NOT FOUND OR historical.revision->>'sourceHtml' IS DISTINCT FROM current_context#>>'{revision,sourceHtml}'
    OR historical.revision->'manifest' IS DISTINCT FROM current_context#>'{revision,manifest}'
    THEN RAISE EXCEPTION 'HTML_EDITING_RESTORE_SOURCE_MISMATCH'; END IF;
  RETURN jsonb_build_object('revision',historical.revision,'revisionSha256',historical.sha256);
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_restore_revision(uuid,uuid,text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_restore_revision(uuid,uuid,text,uuid,integer,text) TO service_role;
COMMIT;
