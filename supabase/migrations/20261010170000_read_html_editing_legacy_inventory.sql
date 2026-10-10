-- PREPARED ONLY. Requires HTML authority/template store and native draft base.
-- Current native inventory, not migration/install/approval/renderer admission.
BEGIN;
CREATE FUNCTION public.read_html_editing_legacy_inventory(p_org uuid,p_actor uuid,p_composition uuid,p_draft uuid,
  p_after_ordinal integer,p_expected_hash text,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private SET lock_timeout = '2s' AS $$
DECLARE saved public.video_composition_draft_documents%ROWTYPE; current_version integer; anchor uuid; entries jsonb; next_ordinal integer; result jsonb;
BEGIN
  IF (p_after_ordinal IS NULL) IS DISTINCT FROM (p_expected_hash IS NULL)
    OR (p_after_ordinal IS NULL) IS DISTINCT FROM (p_expected_version IS NULL)
    OR (p_after_ordinal IS NOT NULL AND p_after_ordinal NOT BETWEEN 1 AND 500)
    OR (p_expected_hash IS NOT NULL AND p_expected_hash !~ '^[a-f0-9]{64}$')
    OR (p_expected_version IS NOT NULL AND p_expected_version <= 0)
    THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_INVALID'; END IF;
  SELECT d.current_version INTO current_version FROM public.video_composition_drafts d WHERE id = p_draft AND organization_id = p_org
    AND composition_id = p_composition AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_UNAVAILABLE'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT active_revision_id INTO anchor FROM public.video_compositions
    WHERE id = p_composition AND organization_id = p_org AND status <> 'ARCHIVED' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_UNAVAILABLE'; END IF;
  IF anchor IS NOT NULL THEN
    PERFORM 1 FROM public.video_composition_revisions WHERE id = anchor
      AND organization_id = p_org AND composition_id = p_composition FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_UNAVAILABLE'; END IF;
  END IF;
  SELECT * INTO saved FROM public.video_composition_draft_documents WHERE draft_id = p_draft
    AND organization_id = p_org ORDER BY version DESC LIMIT 1 FOR SHARE;
  IF NOT FOUND OR saved.document->>'format' IS DISTINCT FROM 'courseforge-composition-v4'
    OR saved.version IS DISTINCT FROM current_version
    OR jsonb_typeof(saved.document->'clips') IS DISTINCT FROM 'array'
    OR jsonb_array_length(saved.document->'clips') > 500 OR octet_length(saved.document::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_UNAVAILABLE'; END IF;
  IF p_after_ordinal IS NOT NULL AND (saved.document_hash IS DISTINCT FROM p_expected_hash OR saved.version IS DISTINCT FROM p_expected_version)
    THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_BASE_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(saved.document->'clips') c WHERE c->>'id' IS NULL)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(saved.document->'clips') c WHERE c->>'kind' = 'DECK_SLIDE'
      AND c#>>'{source,type}' = 'DECK_SLIDE' AND jsonb_typeof(c#>'{source,html}') IS DISTINCT FROM 'string')
    OR jsonb_array_length(saved.document->'clips') <> (SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(saved.document->'clips') c)
    OR (saved.document#>'{htmlEditing,items}' IS NOT NULL AND jsonb_typeof(saved.document#>'{htmlEditing,items}') IS DISTINCT FROM 'array')
    THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_UNAVAILABLE'; END IF;
  WITH available AS (
    SELECT c.clip,c.ordinal::integer AS ordinal FROM jsonb_array_elements(saved.document->'clips') WITH ORDINALITY c(clip,ordinal)
    WHERE c.ordinal > coalesce(p_after_ordinal,0) AND c.clip->>'kind' = 'DECK_SLIDE' AND c.clip#>>'{source,type}' = 'DECK_SLIDE'
    ORDER BY c.ordinal LIMIT 21
  ), page AS (
    SELECT a.ordinal,jsonb_build_object('ordinal',a.ordinal,'clipId',a.clip->>'id',
      'sourceSha256',encode(pg_catalog.sha256(convert_to(a.clip#>>'{source,html}','UTF8')),'hex'),
      'sourceBytes',octet_length(a.clip#>>'{source,html}'),
      'nativePointerPresent',EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(saved.document#>'{htmlEditing,items}','[]'::jsonb)) ref
        WHERE ref->>'clipId' = a.clip->>'id'),
      'registeredTemplatePresent',t.clip_id IS NOT NULL,
      'template',CASE WHEN t.clip_id IS NOT NULL THEN jsonb_build_object(
        'templateId',t.initial_revision#>>'{manifest,binding,templateId}',
        'templateVersion',t.initial_revision#>'{manifest,binding,templateVersion}',
        'sourceSha256',t.initial_revision#>>'{manifest,binding,sourceSha256}','revoked',t.revoked) ELSE NULL END) AS entry
    FROM available a LEFT JOIN private.composition_html_templates t ON t.draft_id = p_draft AND t.organization_id = p_org AND t.clip_id = a.clip->>'id'
    ORDER BY a.ordinal LIMIT 20
  )
  SELECT coalesce(jsonb_agg(entry ORDER BY ordinal),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM available) > 20 THEN (SELECT max(ordinal) FROM page) END INTO entries,next_ordinal FROM page;
  result := jsonb_build_object('scope','CURRENT_HTML_LEGACY_INVENTORY_NOT_ADMISSION_APPROVAL_OR_GRANT',
    'organizationId',p_org,'compositionId',p_composition,'draftId',p_draft,'documentHash',saved.document_hash,
    'nativeVersion',saved.version,'issuanceRevisionId',anchor,'afterOrdinal',p_after_ordinal,'entries',entries,'nextOrdinal',next_ordinal);
  IF octet_length(result::text) > 32768 THEN RAISE EXCEPTION 'HTML_LEGACY_INVENTORY_UNAVAILABLE'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_legacy_inventory(uuid,uuid,uuid,uuid,integer,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_legacy_inventory(uuid,uuid,uuid,uuid,integer,text,integer) TO service_role;
COMMIT;
