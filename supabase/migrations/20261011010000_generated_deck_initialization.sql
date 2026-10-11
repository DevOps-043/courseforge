-- PREPARED ONLY. Requires coordinated generated-deck host/client and preceding
-- HTML bootstrap, exact compilation, native append and font-resource migrations.
-- No templates installed, snapshots activated or existing drafts migrated here.
BEGIN;
CREATE TABLE private.composition_generated_deck_initializations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id), operation_id uuid NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (octet_length(receipt::text) <= 131072),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,draft_id,actor_id,operation_id)
);
ALTER TABLE private.composition_generated_deck_initializations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_generated_deck_initializations FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.composition_generated_deck_initializations IS
  'Historical atomic initialization receipt; never current-state/render authority or permission to retry an unknown operation.';

-- Reuse the authorized bootstrap reader once for the entire saved document.
-- Material provenance is reconstructed independently by the server host.
CREATE FUNCTION public.read_generated_deck_initialization_context(p_org uuid,p_draft uuid,p_actor uuid,p_expected_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE saved public.video_composition_draft_documents%ROWTYPE; first_clip text; component uuid; context jsonb;
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id=p_draft AND organization_id=p_org AND state='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO saved FROM public.video_composition_draft_documents WHERE draft_id=p_draft AND organization_id=p_org ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR p_expected_hash IS NULL OR saved.document_hash IS DISTINCT FROM p_expected_hash
    THEN RAISE EXCEPTION 'HTML_EDITING_REVISION_CONFLICT'; END IF;
  SELECT clip->>'id' INTO first_clip FROM jsonb_array_elements(saved.document->'clips') clip
    WHERE clip->>'kind'='DECK_SLIDE' AND clip#>>'{source,type}'='DECK_SLIDE'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(saved.document#>'{htmlEditing,items}','[]'::jsonb)) ref WHERE ref->>'clipId'=clip->>'id')
    ORDER BY (clip->>'id') COLLATE "C" LIMIT 1;
  IF first_clip IS NULL THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_NO_PENDING_CLIPS'; END IF;
  SELECT c.material_component_id INTO component FROM public.video_compositions c JOIN public.video_composition_drafts draft ON draft.composition_id=c.id
    WHERE draft.id=p_draft AND draft.organization_id=p_org AND c.organization_id=p_org FOR SHARE OF c;
  IF component IS NULL THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_MATERIAL_REQUIRED'; END IF;
  context:=public.read_html_editing_bootstrap_context(p_org,p_draft,first_clip,p_actor,p_expected_hash);
  RETURN context||jsonb_build_object('componentId',component,'documentVersion',saved.version);
END $$;
REVOKE ALL ON FUNCTION public.read_generated_deck_initialization_context(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_generated_deck_initialization_context(uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.read_generated_deck_initialization_operation(p_org uuid,p_draft uuid,p_actor uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE stored private.composition_generated_deck_initializations%ROWTYPE; item jsonb;
BEGIN
  IF p_operation IS NULL THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id=p_draft AND organization_id=p_org AND state='ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  SELECT * INTO stored FROM private.composition_generated_deck_initializations
    WHERE organization_id=p_org AND draft_id=p_draft AND actor_id=p_actor AND operation_id=p_operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  FOR item IN SELECT e FROM jsonb_array_elements(stored.receipt->'items') e ORDER BY (e->>'clipId') COLLATE "C" LOOP
    PERFORM 1 FROM private.composition_html_templates WHERE organization_id=p_org AND draft_id=p_draft AND clip_id=item->>'clipId' AND NOT revoked FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  END LOOP;
  RETURN jsonb_build_object('status','RECORDED','receipt',stored.receipt);
END $$;
REVOKE ALL ON FUNCTION public.read_generated_deck_initialization_operation(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_generated_deck_initialization_operation(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.commit_generated_deck_initialization(p_org uuid,p_draft uuid,p_actor uuid,p_operation uuid,
  p_request_sha256 text,p_expected_hash text,p_registrations jsonb,p_document jsonb,p_document_hash text,p_fonts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE stored jsonb; saved public.video_composition_draft_documents%ROWTYPE; context jsonb; pending_ids jsonb;
  registration jsonb; revision jsonb; reference jsonb; references_json jsonb; receipt_items jsonb:='[]'::jsonb;
  expected_document jsonb; used_ids uuid[]; created boolean; latest private.composition_html_revisions%ROWTYPE;
  appended record; result_receipt jsonb;
BEGIN
  IF p_org IS NULL OR p_draft IS NULL OR p_actor IS NULL OR p_operation IS NULL
    OR p_expected_hash IS NULL OR p_expected_hash !~ '^[a-f0-9]{64}$'
    OR p_request_sha256 IS NULL OR p_request_sha256 IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(
      '{"format":"courseforge-generated-deck-initialization-v1","expectedDocumentHash":"'||p_expected_hash||'"}','UTF8')),'hex')
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$' OR p_document_hash=p_expected_hash
    OR p_registrations IS NULL OR jsonb_typeof(p_registrations) IS DISTINCT FROM 'array'
    OR octet_length(p_registrations::text)>8388608 OR p_document IS NULL OR octet_length(p_document::text)>16777216
    THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_INVALID'; END IF;
  IF jsonb_array_length(p_registrations) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_INVALID'; END IF;
  BEGIN
    PERFORM 1 FROM public.video_composition_drafts WHERE id=p_draft AND organization_id=p_org AND state='ACTIVE' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_CONFLICT'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_org,p_actor);
  stored:=public.read_generated_deck_initialization_operation(p_org,p_draft,p_actor,p_operation);
  IF stored->>'status'='RECORDED' THEN
    IF stored#>>'{receipt,requestSha256}' IS DISTINCT FROM p_request_sha256
      OR stored#>>'{receipt,expectedDocumentHash}' IS DISTINCT FROM p_expected_hash
      THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_ID_REUSED'; END IF;
    RETURN stored->'receipt'; -- Historical only; no append/registration/reactivation.
  END IF;
  context:=public.read_generated_deck_initialization_context(p_org,p_draft,p_actor,p_expected_hash);
  SELECT * INTO saved FROM public.video_composition_draft_documents WHERE draft_id=p_draft AND organization_id=p_org ORDER BY version DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(clip->>'id' ORDER BY (clip->>'id') COLLATE "C"),'[]'::jsonb) INTO pending_ids
    FROM jsonb_array_elements(saved.document->'clips') clip WHERE clip->>'kind'='DECK_SLIDE' AND clip#>>'{source,type}'='DECK_SLIDE'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(saved.document#>'{htmlEditing,items}','[]'::jsonb)) ref WHERE ref->>'clipId'=clip->>'id');
  IF pending_ids IS DISTINCT FROM (SELECT jsonb_agg(e->>'clipId' ORDER BY (e->>'clipId') COLLATE "C") FROM jsonb_array_elements(p_registrations) e)
    OR jsonb_array_length(pending_ids)<>(SELECT count(DISTINCT e->>'clipId') FROM jsonb_array_elements(p_registrations) e)
    THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_CLIP_SET_INVALID'; END IF;
  -- Current font authority is locked for the outer transaction, not only checked
  -- before the HTTP write. Existing media/uploaded/Google policy stays unchanged.
  PERFORM private.html_snapshot_resource_bindings(p_org,p_draft,'[]'::jsonb,p_fonts);
  -- No omission/substitution of a native declaration, even with valid READY IDs.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(saved.document->'clips') clip,
      jsonb_array_elements(coalesce(clip#>'{source,fontBindings}','[]'::jsonb)) binding
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fonts) font
      WHERE font->>'fontAssetId'=binding->>'fontAssetId' AND font->>'family'=binding->>'fontFamily'
        AND font->'googleFace' IS NOT DISTINCT FROM binding->'googleFace')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(saved.document->'clips') clip
    WHERE clip#>>'{source,style,fontAssetId}' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_fonts) font WHERE font->>'fontAssetId'=clip#>>'{source,style,fontAssetId}'
        AND font->>'family'=clip#>>'{source,style,fontFamily}')
  ) THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_FONT_SET_INVALID'; END IF;
  references_json:=coalesce(saved.document#>'{htmlEditing,items}','[]'::jsonb);
  FOR registration IN SELECT e FROM jsonb_array_elements(p_registrations) e ORDER BY (e->>'clipId') COLLATE "C" LOOP
    revision:=registration->'revision';
    IF jsonb_typeof(registration) IS DISTINCT FROM 'object' OR registration-ARRAY['clipId','revision','revisionSha256','usedAssetIds']<>'{}'::jsonb
      OR registration->>'clipId' IS NULL OR registration->>'clipId' !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'
      OR registration->>'revisionSha256' IS NULL OR registration->>'revisionSha256' !~ '^[a-f0-9]{64}$'
      OR revision IS NULL OR octet_length(revision::text)>1048576
      OR revision#>>'{manifest,binding,revisionId}' IS DISTINCT FROM context->>'revisionId'
      OR jsonb_typeof(registration->'usedAssetIds') IS DISTINCT FROM 'array'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(saved.document->'clips') clip WHERE clip->>'id'=registration->>'clipId' AND clip#>>'{source,htmlAssetId}' IS NOT NULL)
      THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_INVALID'; END IF;
    SELECT coalesce(array_agg(id::uuid),'{}'::uuid[]) INTO used_ids FROM jsonb_array_elements_text(registration->'usedAssetIds') asset(id);
    created:=public.register_html_editing_template_v2(p_org,p_draft,p_actor,registration->>'clipId',p_expected_hash,revision,registration->>'revisionSha256',used_ids);
    SELECT * INTO latest FROM private.composition_html_revisions WHERE organization_id=p_org AND draft_id=p_draft AND clip_id=registration->>'clipId' ORDER BY version DESC LIMIT 1;
    IF created IS NULL OR latest.version IS DISTINCT FROM 1 OR latest.revision IS DISTINCT FROM revision
      OR latest.sha256 IS DISTINCT FROM registration->>'revisionSha256' THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_UNCONFIRMED'; END IF;
    reference:=jsonb_build_object('clipId',registration->>'clipId','revisionVersion',1,'revisionSha256',latest.sha256,
      'templateId',revision#>>'{manifest,binding,templateId}','templateVersion',(revision#>>'{manifest,binding,templateVersion}')::integer,
      'sourceSha256',revision#>>'{manifest,binding,sourceSha256}','manifestSha256',revision#>>'{manifest,binding,manifestSha256}');
    references_json:=references_json||jsonb_build_array(reference);
    receipt_items:=receipt_items||jsonb_build_array(reference||jsonb_build_object('created',created));
  END LOOP;
  SELECT jsonb_agg(e ORDER BY (e->>'clipId') COLLATE "C") INTO references_json FROM jsonb_array_elements(references_json) e;
  IF jsonb_array_length(references_json)>200 THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_INVALID'; END IF;
  expected_document:=jsonb_set(jsonb_set(saved.document,'{format}','"courseforge-composition-v4"'::jsonb),
    '{htmlEditing}',jsonb_build_object('format','courseforge-html-editable-references-v1','items',references_json));
  IF p_document IS DISTINCT FROM expected_document THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_DOCUMENT_INVALID'; END IF;
  -- Reuse native CAS/version/audit; one native save, never one save per clip.
  SELECT * INTO appended FROM public.append_video_composition_draft_document_v2(p_draft,p_org,p_expected_hash,p_document,p_document_hash,
    'courseforge-composition-v4',p_actor,'USER','Preparó las diapositivas generadas para edición.',
    jsonb_build_object('operation','GENERATED_DECK_INITIALIZATION','operationId',p_operation,'clipCount',jsonb_array_length(p_registrations)));
  IF appended.outcome IS DISTINCT FROM 'APPENDED' OR appended.document_hash IS DISTINCT FROM p_document_hash
    OR appended.version IS DISTINCT FROM saved.version+1 THEN RAISE EXCEPTION 'GENERATED_DECK_INITIALIZATION_UNCONFIRMED'; END IF;
  -- Check all exact references, including unchanged authored neighbours, and
  -- current template/grant authority before the outer transaction can commit.
  PERFORM public.read_html_editing_compilation(p_org,p_draft,p_actor,p_document_hash);
  result_receipt:=jsonb_build_object('scope','GENERATED_DECK_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED',
    'owner',jsonb_build_object('actorId',p_actor,'organizationId',p_org,'draftId',p_draft),
    'operationId',p_operation,'requestSha256',p_request_sha256,'expectedDocumentHash',p_expected_hash,
    'documentHash',p_document_hash,'documentVersion',appended.version,'items',receipt_items);
  -- Failure here rolls back every registration, native document and audit row.
  INSERT INTO private.composition_generated_deck_initializations(organization_id,draft_id,actor_id,operation_id,request_sha256,receipt)
    VALUES(p_org,p_draft,p_actor,p_operation,p_request_sha256,result_receipt);
  RETURN result_receipt;
END $$;
REVOKE ALL ON FUNCTION public.commit_generated_deck_initialization(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commit_generated_deck_initialization(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,text,jsonb) TO service_role;
COMMIT;
