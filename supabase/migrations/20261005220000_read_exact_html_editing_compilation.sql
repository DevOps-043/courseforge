-- PREPARED ONLY. Requires both HTML history/append migrations; no activation.
-- Hashes and full schemas are revalidated by the trusted host, not reproduced in SQL.
BEGIN;
CREATE FUNCTION public.read_html_editing_compilation(p_organization_id uuid,p_draft_id uuid,
  p_actor_id uuid,p_document_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE d public.video_composition_draft_documents%ROWTYPE; reference jsonb; source_clip jsonb;
  t private.composition_html_templates%ROWTYPE; r private.composition_html_revisions%ROWTYPE;
  entries jsonb := '[]'::jsonb; result jsonb; reference_count integer;
BEGIN
  IF p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID';
  END IF;
  -- Root draft lock serializes revocation, unlink and document/history mutation.
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id
    AND organization_id = p_organization_id AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  -- Repeated native hashes select their latest identical saved occurrence.
  -- Never substitute the latest document, nor the latest HTML revision.
  SELECT * INTO d FROM public.video_composition_draft_documents WHERE draft_id = p_draft_id
    AND organization_id = p_organization_id AND document_hash = p_document_hash
    ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR d.document->>'format' IS DISTINCT FROM 'courseforge-composition-v4'
    OR d.document#>>'{htmlEditing,format}' IS DISTINCT FROM 'courseforge-html-editable-references-v1'
    OR jsonb_typeof(d.document#>'{htmlEditing,items}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID';
  END IF;
  reference_count := jsonb_array_length(d.document#>'{htmlEditing,items}');
  IF reference_count NOT BETWEEN 1 AND 200 OR reference_count <> (
    SELECT count(DISTINCT item->>'clipId') FROM jsonb_array_elements(d.document#>'{htmlEditing,items}') item
  ) THEN RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID'; END IF;
  FOR reference IN SELECT item FROM jsonb_array_elements(d.document#>'{htmlEditing,items}') item
    ORDER BY (item->>'clipId') COLLATE "C"
  LOOP
    IF reference->>'revisionVersion' IS NULL OR reference->>'revisionVersion' !~ '^[0-9]{1,7}$'
      OR reference->>'revisionSha256' IS NULL OR reference->>'revisionSha256' !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID';
    END IF;
    IF (reference->>'revisionVersion')::integer NOT BETWEEN 1 AND 1000000 THEN
      RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID';
    END IF;
    SELECT * INTO t FROM private.composition_html_templates WHERE draft_id = p_draft_id
      AND organization_id = p_organization_id AND clip_id = reference->>'clipId' AND NOT revoked FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
    SELECT * INTO r FROM private.composition_html_revisions WHERE draft_id = p_draft_id
      AND organization_id = p_organization_id AND clip_id = t.clip_id
      AND version = (reference->>'revisionVersion')::integer AND sha256 = reference->>'revisionSha256' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID'; END IF;
    SELECT c INTO source_clip FROM jsonb_array_elements(d.document->'clips') c WHERE c->>'id' = t.clip_id;
    IF source_clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE' OR source_clip#>>'{source,type}' IS DISTINCT FROM 'DECK_SLIDE'
      OR source_clip#>>'{source,html}' IS DISTINCT FROM t.initial_revision->>'sourceHtml'
      OR r.revision->>'sourceHtml' IS DISTINCT FROM t.initial_revision->>'sourceHtml'
      OR r.revision->'manifest' IS DISTINCT FROM t.initial_revision->'manifest'
      OR r.revision#>'{state,binding}' IS DISTINCT FROM t.initial_revision#>'{manifest,binding}'
      OR reference->>'templateId' IS DISTINCT FROM t.initial_revision#>>'{manifest,binding,templateId}'
      OR reference->>'templateVersion' IS DISTINCT FROM t.initial_revision#>>'{manifest,binding,templateVersion}'
      OR reference->>'sourceSha256' IS DISTINCT FROM t.initial_revision#>>'{manifest,binding,sourceSha256}'
      OR reference->>'manifestSha256' IS DISTINCT FROM t.initial_revision#>>'{manifest,binding,manifestSha256}' THEN
      RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID';
    END IF;
    entries := entries || jsonb_build_array(jsonb_build_object('revision',r.revision,
      'authoritativeBinding',t.initial_revision#>'{manifest,binding}',
      'grantedAssetIds',private.html_editing_grants(p_organization_id,p_draft_id,t.initial_revision)));
    IF octet_length(entries::text) > 16777216 THEN RAISE EXCEPTION 'HTML_EDITING_PAYLOAD_LIMIT'; END IF;
  END LOOP;
  result := jsonb_build_object('document',d.document,'documentHash',d.document_hash,'revisions',entries);
  IF octet_length(result::text) > 16777216 THEN RAISE EXCEPTION 'HTML_EDITING_PAYLOAD_LIMIT'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_compilation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_compilation(uuid,uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.read_html_editing_compilation(uuid,uuid,uuid,text) IS
  'Prepared exact historical native-pointer reader; current tenant role/template revocation/grants required. No materialized-byte attestation or rollout.';
COMMIT;
