-- PREPARED ONLY. Apply together with registry/host release; do not register templates yet.
BEGIN;
CREATE FUNCTION public.append_html_editing_revision(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,
  p_expected_version integer,p_expected_sha256 text,p_expected_document_hash text,p_binding jsonb,p_revision jsonb,
  p_revision_sha256 text,p_document jsonb,p_document_hash text,p_used_asset_ids jsonb,p_operation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE d public.video_composition_draft_documents%ROWTYPE; t private.composition_html_templates%ROWTYPE;
  r private.composition_html_revisions%ROWTYPE; reference jsonb; references_json jsonb; expected_document jsonb;
  grants jsonb; append_result record; supplied_reference jsonb;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version NOT BETWEEN 1 AND 999999
    OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_document_hash IS NULL OR p_expected_document_hash !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_revision_sha256 IS NULL OR p_revision_sha256 !~ '^[a-f0-9]{64}$'
    OR p_operation IS NULL OR p_operation NOT IN ('COMMAND','RESTORE')
    OR p_revision IS NULL OR p_document IS NULL OR p_used_asset_ids IS NULL
    OR jsonb_typeof(p_used_asset_ids) <> 'array' OR jsonb_array_length(p_used_asset_ids) > 6400
    OR octet_length(p_revision::text) > 1048576 OR octet_length(p_document::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_EDITING_APPEND_INVALID'; END IF;
  -- Same draft-first lock order as generic native append. Re-entrant delegate below.
  BEGIN
    PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','CONFLICT'); END;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO t FROM private.composition_html_templates WHERE draft_id = p_draft_id AND clip_id = p_clip_id AND organization_id = p_organization_id AND NOT revoked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  SELECT * INTO d FROM public.video_composition_draft_documents WHERE draft_id = p_draft_id AND organization_id = p_organization_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO r FROM private.composition_html_revisions WHERE draft_id = p_draft_id AND clip_id = p_clip_id AND organization_id = p_organization_id ORDER BY version DESC LIMIT 1;
  IF d.id IS NULL OR r.draft_id IS NULL OR d.document_hash IS DISTINCT FROM p_expected_document_hash
    OR r.version <> p_expected_version OR r.sha256 IS DISTINCT FROM p_expected_sha256 THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT item INTO supplied_reference FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) item WHERE item->>'clipId' = p_clip_id;
  IF (supplied_reference IS NULL AND r.version <> 1) OR (supplied_reference IS NOT NULL AND
    (supplied_reference->>'revisionVersion' IS DISTINCT FROM r.version::text OR supplied_reference->>'revisionSha256' IS DISTINCT FROM r.sha256))
    THEN RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID'; END IF;
  IF p_binding IS DISTINCT FROM t.initial_revision#>'{manifest,binding}'
    OR p_revision->>'format' IS DISTINCT FROM 'courseforge-html-editable-revision-v1'
    OR p_revision->>'sourceHtml' IS DISTINCT FROM t.initial_revision->>'sourceHtml'
    OR p_revision->'manifest' IS DISTINCT FROM t.initial_revision->'manifest'
    OR p_revision#>'{state,binding}' IS DISTINCT FROM p_binding
    OR p_revision#>>'{state,format}' IS DISTINCT FROM 'courseforge-html-editable-override-state-v1'
    OR p_revision->>'version' IS DISTINCT FROM (p_expected_version + 1)::text
    OR jsonb_typeof(p_revision#>'{state,overrides}') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'HTML_EDITING_SOURCE_INVALID'; END IF;
  grants := private.html_editing_grants(p_organization_id,p_draft_id,t.initial_revision);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_used_asset_ids) used(id) WHERE NOT (grants ? used.id))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_revision#>'{state,overrides}') item
      WHERE item->>'operation' = 'SET_IMAGE' AND NOT (grants ? (item->>'assetId')))
    THEN RAISE EXCEPTION 'HTML_EDITING_ASSET_NOT_AUTHORIZED'; END IF;
  -- The service-only host validates source, canonical revision/native digests,
  -- schemas, template defaults and complete referenced-asset set before this RPC.
  reference := jsonb_build_object('clipId',p_clip_id,'revisionVersion',p_expected_version + 1,'revisionSha256',p_revision_sha256,
    'templateId',p_binding->>'templateId','templateVersion',(p_binding->>'templateVersion')::integer,
    'sourceSha256',p_binding->>'sourceSha256','manifestSha256',p_binding->>'manifestSha256');
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'clipId') COLLATE "C"),'[]'::jsonb) INTO references_json FROM (
    SELECT item FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) item WHERE item->>'clipId' <> p_clip_id
    UNION ALL SELECT reference
  ) assembled;
  expected_document := jsonb_set(jsonb_set(d.document,'{format}','"courseforge-composition-v4"'::jsonb),
    '{htmlEditing}',jsonb_build_object('format','courseforge-html-editable-references-v1','items',references_json));
  IF p_document IS DISTINCT FROM expected_document OR p_document_hash = d.document_hash THEN RAISE EXCEPTION 'HTML_EDITING_DOCUMENT_INVALID'; END IF;
  -- No partial publication: native append/audit and subdocument insertion share one transaction.
  SELECT * INTO append_result FROM public.append_video_composition_draft_document_v2(p_draft_id,p_organization_id,
    p_expected_document_hash,p_document,p_document_hash,'courseforge-composition-v4',p_actor_id,'USER',
    'Actualizó una revisión HTML editable.',jsonb_build_object('operation',p_operation,'clipId',p_clip_id,'htmlVersion',p_expected_version + 1));
  IF append_result.outcome IS DISTINCT FROM 'APPENDED' THEN RAISE EXCEPTION 'HTML_EDITING_NATIVE_APPEND_UNCONFIRMED'; END IF;
  INSERT INTO private.composition_html_revisions(organization_id,draft_id,clip_id,version,revision,sha256,created_by)
    VALUES(p_organization_id,p_draft_id,p_clip_id,p_expected_version + 1,p_revision,p_revision_sha256,p_actor_id);
  RETURN jsonb_build_object('status','COMMITTED','version',p_expected_version + 1,'sha256',p_revision_sha256);
END $$;
REVOKE ALL ON FUNCTION public.append_html_editing_revision(uuid,uuid,text,uuid,integer,text,text,jsonb,jsonb,text,jsonb,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_html_editing_revision(uuid,uuid,text,uuid,integer,text,text,jsonb,jsonb,text,jsonb,text,jsonb,text) TO service_role;
COMMIT;
