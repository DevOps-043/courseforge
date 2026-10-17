-- PREPARED ONLY. Read-only companion to generated-deck initialization.
-- One draft-root lock: latest native + exact references/current grants/fonts.
BEGIN;
CREATE FUNCTION public.read_current_generated_deck_initialization(p_org uuid,p_draft uuid,p_actor uuid,p_operation uuid,
  p_request_sha256 text,p_document_hash text,p_fonts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE saved public.video_composition_draft_documents%ROWTYPE; recorded jsonb; receipt jsonb; item jsonb; entry jsonb; compilation jsonb;
BEGIN
  IF p_operation IS NULL OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id=p_draft AND organization_id=p_org AND state='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  recorded:=public.read_generated_deck_initialization_operation(p_org,p_draft,p_actor,p_operation);
  receipt:=recorded->'receipt';
  IF recorded->>'status' IS DISTINCT FROM 'RECORDED' OR receipt->>'requestSha256' IS DISTINCT FROM p_request_sha256
    OR receipt->>'documentHash' IS DISTINCT FROM p_document_hash THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_UNCONFIRMED'; END IF;
  SELECT * INTO saved FROM public.video_composition_draft_documents WHERE organization_id=p_org AND draft_id=p_draft ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR saved.document_hash IS DISTINCT FROM p_document_hash OR saved.version::text IS DISTINCT FROM receipt->>'documentVersion'
    THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_CURRENT_CHANGED'; END IF;
  PERFORM private.html_snapshot_resource_bindings(p_org,p_draft,'[]'::jsonb,p_fonts);
  -- Require every native font declaration, not an empty valid font manifest.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(saved.document->'clips') clip,
    jsonb_array_elements(coalesce(clip#>'{source,fontBindings}','[]'::jsonb)) binding
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fonts) font WHERE font->>'fontAssetId'=binding->>'fontAssetId'
      AND font->>'family'=binding->>'fontFamily' AND font->'googleFace' IS NOT DISTINCT FROM binding->'googleFace'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(saved.document->'clips') clip WHERE clip#>>'{source,style,fontAssetId}' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fonts) font WHERE font->>'fontAssetId'=clip#>>'{source,style,fontAssetId}'
        AND font->>'family'=clip#>>'{source,style,fontFamily}'))
    THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_FONT_SET_INVALID'; END IF;
  compilation:=public.read_html_editing_compilation(p_org,p_draft,p_actor,p_document_hash);
  FOR item IN SELECT e FROM jsonb_array_elements(receipt->'items') e LOOP
    SELECT e INTO entry FROM jsonb_array_elements(compilation->'revisions') e WHERE e#>>'{authoritativeBinding,clipId}'=item->>'clipId';
    IF NOT FOUND OR entry#>>'{revision,version}' IS DISTINCT FROM '1'
      OR entry#>'{revision,state,overrides}' IS DISTINCT FROM '[]'::jsonb
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(saved.document#>'{htmlEditing,items}') ref WHERE ref=item-'created')
      THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_CURRENT_CHANGED'; END IF;
  END LOOP;
  RETURN jsonb_build_object('receipt',receipt,'documentVersion',saved.version,'compilation',compilation);
END $$;
REVOKE ALL ON FUNCTION public.read_current_generated_deck_initialization(uuid,uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_current_generated_deck_initialization(uuid,uuid,uuid,uuid,text,text,jsonb) TO service_role;
COMMIT;
