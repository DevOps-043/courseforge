-- PREPARED ONLY: no migration application, catalog registration or endpoint rollout.
BEGIN;
-- The existing service-only registration owns the draft-root/actor/source/CAS
-- checks. This wrapper adds current grants for actual resource dependencies in
-- the SAME transaction. A failed check rolls back a newly inserted template.
-- p_used_asset_ids must be derived by the trusted host compiler, not a client.
CREATE FUNCTION public.register_html_editing_template_v2(
  p_organization_id uuid,p_draft_id uuid,p_actor_id uuid,p_clip_id text,
  p_expected_document_hash text,p_revision jsonb,p_revision_sha256 text,p_used_asset_ids uuid[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE created boolean; grants jsonb; asset_id uuid;
BEGIN
  IF p_used_asset_ids IS NULL OR cardinality(p_used_asset_ids) > 6400
    OR array_position(p_used_asset_ids,NULL) IS NOT NULL
    OR cardinality(p_used_asset_ids) <> (SELECT count(DISTINCT item) FROM unnest(p_used_asset_ids) item)
    THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  created := public.register_html_editing_template(p_organization_id,p_draft_id,p_actor_id,p_clip_id,
    p_expected_document_hash,p_revision,p_revision_sha256);
  grants := private.html_editing_grants(p_organization_id,p_draft_id,p_revision);
  FOREACH asset_id IN ARRAY p_used_asset_ids LOOP
    IF NOT grants ? asset_id::text THEN RAISE EXCEPTION 'HTML_EDITING_ASSET_NOT_AUTHORIZED'; END IF;
  END LOOP;
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.register_html_editing_template_v2(uuid,uuid,uuid,text,text,jsonb,text,uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_html_editing_template_v2(uuid,uuid,uuid,text,text,jsonb,text,uuid[])
  TO service_role;
COMMENT ON FUNCTION public.register_html_editing_template_v2(uuid,uuid,uuid,text,text,jsonb,text,uuid[])
  IS 'Prepared host-only bootstrap with draft CAS and current used-resource grants; no byte or render attestation.';
COMMIT;
