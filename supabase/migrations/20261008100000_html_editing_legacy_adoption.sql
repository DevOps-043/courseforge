-- PREPARED ONLY. Reserved CAP029; do not apply, register candidates or enable routes.
-- Depends on HTML store/authority/bootstrap and native append-v2 migrations.
BEGIN;
CREATE TABLE private.composition_html_legacy_candidates (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  clip_id text NOT NULL CHECK (clip_id ~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'),
  candidate_id uuid NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES public.profiles(id),
  candidate jsonb NOT NULL CHECK (octet_length(candidate::text) <= 4194304),
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,draft_id,candidate_id),
  UNIQUE (organization_id,draft_id,clip_id,candidate_id)
);
CREATE TABLE private.composition_html_legacy_adoption_receipts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id), operation_id uuid NOT NULL,
  clip_id text NOT NULL, candidate_id uuid NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (octet_length(receipt::text) <= 4096),
  used_asset_ids uuid[] NOT NULL CHECK (cardinality(used_asset_ids) <= 6400),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,draft_id,actor_id,operation_id),
  FOREIGN KEY (organization_id,draft_id,clip_id,candidate_id)
    REFERENCES private.composition_html_legacy_candidates(organization_id,draft_id,clip_id,candidate_id),
  FOREIGN KEY (draft_id,clip_id) REFERENCES private.composition_html_templates(draft_id,clip_id)
);
ALTER TABLE private.composition_html_legacy_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.composition_html_legacy_adoption_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_legacy_candidates,private.composition_html_legacy_adoption_receipts
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.composition_html_legacy_candidates IS
  'Immutable reviewed pilot/provenance, retained with native history. Host verifies package/compiler/catalogue before service-only registration. No implicit approval.';
COMMENT ON TABLE private.composition_html_legacy_adoption_receipts IS
  'Historical adoption result only. Missing receipt never authorizes retry. Retain with draft and preserve original source/version.';

CREATE FUNCTION public.record_html_editing_legacy_candidate(p_organization_id uuid,p_draft_id uuid,p_clip_id text,
  p_actor_id uuid,p_candidate jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE context jsonb; pilot jsonb; original_clip jsonb; stored private.composition_html_legacy_candidates%ROWTYPE;
  new_candidate_id uuid; hash_key text;
BEGIN
  IF p_candidate IS NULL OR jsonb_typeof(p_candidate) IS DISTINCT FROM 'object'
    OR octet_length(p_candidate::text) > 4194304
    OR p_candidate->>'organizationId' IS DISTINCT FROM p_organization_id::text
    OR p_candidate->>'documentId' IS DISTINCT FROM p_draft_id::text
    OR p_candidate->>'clipId' IS DISTINCT FROM p_clip_id
    OR p_candidate#>>'{approval,reviewerId}' IS DISTINCT FROM p_actor_id::text
    OR p_candidate#>'{approval,completedReviews}' IS DISTINCT FROM
      '["VISUAL_COMPARISON","MANIFEST_AND_ACCESSIBILITY","AUTHORIZED_INSTALLATION"]'::jsonb
    OR p_candidate->>'encodedPilot' IS NULL OR octet_length(p_candidate->>'encodedPilot') > 2097152
    OR p_candidate->>'candidateId' IS NULL THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  FOREACH hash_key IN ARRAY ARRAY['expectedDocumentHash','originalSourceSha256','candidateSourceSha256','provenanceSha256'] LOOP
    IF p_candidate->>hash_key IS NULL OR p_candidate->>hash_key !~ '^[a-f0-9]{64}$'
      THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  END LOOP;
  IF p_candidate#>>'{approval,evidenceSha256}' IS NULL
    OR p_candidate#>>'{approval,evidenceSha256}' !~ '^[a-f0-9]{64}$'
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  new_candidate_id := (p_candidate->>'candidateId')::uuid;
  BEGIN
    PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id
      AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_CONFLICT'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO stored FROM private.composition_html_legacy_candidates WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND candidate_id = new_candidate_id;
  IF FOUND THEN
    IF stored.revoked OR stored.clip_id IS DISTINCT FROM p_clip_id OR stored.candidate IS DISTINCT FROM p_candidate
      THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_ID_REUSED'; END IF;
    RETURN false;
  END IF;
  context := public.read_html_editing_bootstrap_context(p_organization_id,p_draft_id,p_clip_id,p_actor_id,
    p_candidate->>'expectedDocumentHash');
  IF context->>'revisionId' IS DISTINCT FROM p_candidate->>'revisionId' THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_CONFLICT'; END IF;
  pilot := (p_candidate->>'encodedPilot')::jsonb;
  SELECT c INTO original_clip FROM jsonb_array_elements(context#>'{document,clips}') c WHERE c->>'id' = p_clip_id;
  IF pilot#>>'{original,sourceHtml}' IS DISTINCT FROM original_clip#>>'{source,html}'
    OR pilot#>>'{original,sha256}' IS DISTINCT FROM p_candidate->>'originalSourceSha256'
    OR pilot#>>'{candidate,sha256}' IS DISTINCT FROM p_candidate->>'candidateSourceSha256'
    OR pilot->>'provenanceSha256' IS DISTINCT FROM p_candidate->>'provenanceSha256'
    OR pilot#>>'{candidate,template,templateId}' IS DISTINCT FROM p_candidate->>'templateId'
    OR pilot#>>'{candidate,template,templateVersion}' IS DISTINCT FROM p_candidate->>'templateVersion'
    OR pilot#>>'{provenance,nativeAnchor,organizationId}' IS DISTINCT FROM p_organization_id::text
    OR pilot#>>'{provenance,nativeAnchor,documentId}' IS DISTINCT FROM p_draft_id::text
    OR pilot#>>'{provenance,nativeAnchor,clipId}' IS DISTINCT FROM p_clip_id
    OR pilot#>>'{provenance,nativeAnchor,revisionId}' IS DISTINCT FROM context->>'revisionId'
    OR pilot#>>'{provenance,nativeAnchor,documentSha256}' IS DISTINCT FROM context->>'documentHash'
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  -- Trusted host must verify canonical hashes, compiler profile and independent
  -- catalogue before this RPC. Review evidence is supplied by a human workflow,
  -- never inferred from pilot.status=REVIEW_REQUIRED or successful compilation.
  INSERT INTO private.composition_html_legacy_candidates(organization_id,draft_id,clip_id,candidate_id,reviewed_by,candidate)
    VALUES(p_organization_id,p_draft_id,p_clip_id,new_candidate_id,p_actor_id,p_candidate);
  RETURN true;
END $$;

CREATE FUNCTION public.read_html_editing_legacy_candidate(p_organization_id uuid,p_draft_id uuid,p_clip_id text,
  p_actor_id uuid,p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_legacy_candidates%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id
    AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO stored FROM private.composition_html_legacy_candidates WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND candidate_id = p_candidate_id AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_UNAVAILABLE'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,stored.reviewed_by);
  RETURN stored.candidate;
END $$;

CREATE FUNCTION public.revoke_html_editing_legacy_candidate(p_organization_id uuid,p_draft_id uuid,p_clip_id text,
  p_actor_id uuid,p_candidate_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  UPDATE private.composition_html_legacy_candidates SET revoked = true WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND candidate_id = p_candidate_id AND NOT revoked;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.commit_html_editing_legacy_adoption(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,
  p_operation_id uuid,p_request_sha256 text,p_request jsonb,p_revision jsonb,p_revision_sha256 text,
  p_document jsonb,p_document_hash text,p_used_asset_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE candidate private.composition_html_legacy_candidates%ROWTYPE;
  stored private.composition_html_legacy_adoption_receipts%ROWTYPE; d public.video_composition_draft_documents%ROWTYPE;
  pilot jsonb; original_clip jsonb; binding jsonb; reference jsonb; references_json jsonb;
  clips_json jsonb; expected_document jsonb; grants jsonb; append_result record; result_receipt jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
    OR p_request IS NULL OR octet_length(p_request::text) > 1024
    OR p_request->>'candidateId' IS NULL OR p_request->>'provenanceSha256' IS NULL
    OR p_request->>'provenanceSha256' !~ '^[a-f0-9]{64}$'
    OR p_request->>'expectedDocumentHash' IS NULL OR p_request->>'expectedDocumentHash' !~ '^[a-f0-9]{64}$'
    OR p_revision IS NULL OR octet_length(p_revision::text) > 1048576
    OR p_document IS NULL OR octet_length(p_document::text) > 16777216
    OR p_revision_sha256 IS NULL OR p_revision_sha256 !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_used_asset_ids IS NULL OR cardinality(p_used_asset_ids) > 6400
    OR array_position(p_used_asset_ids,NULL) IS NOT NULL
    OR cardinality(p_used_asset_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_used_asset_ids) id)
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  BEGIN
    PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id
      AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_CONFLICT'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO candidate FROM private.composition_html_legacy_candidates WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND candidate_id = (p_request->>'candidateId')::uuid AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_UNAVAILABLE'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,candidate.reviewed_by);
  IF candidate.candidate->>'provenanceSha256' IS DISTINCT FROM p_request->>'provenanceSha256'
    OR candidate.candidate->>'expectedDocumentHash' IS DISTINCT FROM p_request->>'expectedDocumentHash'
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_CONFLICT'; END IF;
  SELECT * INTO stored FROM private.composition_html_legacy_adoption_receipts WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND actor_id = p_actor_id AND operation_id = p_operation_id;
  IF FOUND THEN
    IF stored.clip_id IS DISTINCT FROM p_clip_id OR stored.request_sha256 IS DISTINCT FROM p_request_sha256
      OR stored.receipt->'request' IS DISTINCT FROM p_request OR stored.receipt#>>'{acknowledgment,revisionSha256}' IS DISTINCT FROM p_revision_sha256
      OR stored.receipt#>>'{acknowledgment,compositionDocumentHash}' IS DISTINCT FROM p_document_hash
      THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_ID_REUSED'; END IF;
    PERFORM public.read_html_editing_legacy_adoption_operation(p_organization_id,p_draft_id,p_clip_id,p_actor_id,p_operation_id);
    RETURN stored.receipt;
  END IF;
  SELECT * INTO d FROM public.video_composition_draft_documents WHERE draft_id = p_draft_id AND organization_id = p_organization_id
    ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR d.document_hash IS DISTINCT FROM p_request->>'expectedDocumentHash' THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_CONFLICT'; END IF;
  IF EXISTS (SELECT 1 FROM private.composition_html_templates WHERE draft_id = p_draft_id AND clip_id = p_clip_id)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) item WHERE item->>'clipId' = p_clip_id)
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_CONFLICT'; END IF;
  pilot := (candidate.candidate->>'encodedPilot')::jsonb;
  SELECT c INTO original_clip FROM jsonb_array_elements(d.document->'clips') c WHERE c->>'id' = p_clip_id;
  binding := p_revision#>'{manifest,binding}';
  IF original_clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE' OR original_clip#>>'{source,type}' IS DISTINCT FROM 'DECK_SLIDE'
    OR original_clip#>>'{source,html}' IS DISTINCT FROM pilot#>>'{original,sourceHtml}'
    OR p_revision->>'sourceHtml' IS DISTINCT FROM pilot#>>'{candidate,sourceHtml}'
    OR p_revision->>'format' IS DISTINCT FROM 'courseforge-html-editable-revision-v1' OR p_revision->>'version' IS DISTINCT FROM '1'
    OR binding->>'organizationId' IS DISTINCT FROM p_organization_id::text OR binding->>'documentId' IS DISTINCT FROM p_draft_id::text
    OR binding->>'clipId' IS DISTINCT FROM p_clip_id OR binding->>'documentSha256' IS DISTINCT FROM d.document_hash
    OR binding->>'revisionId' IS DISTINCT FROM candidate.candidate->>'revisionId'
    OR binding->>'templateId' IS DISTINCT FROM candidate.candidate->>'templateId'
    OR binding->>'templateVersion' IS DISTINCT FROM candidate.candidate->>'templateVersion'
    OR binding->>'sourceSha256' IS DISTINCT FROM candidate.candidate->>'candidateSourceSha256'
    OR binding->>'manifestSha256' IS NULL OR binding->>'manifestSha256' !~ '^[a-f0-9]{64}$'
    OR p_revision#>'{state,binding}' IS DISTINCT FROM binding
    OR p_revision#>>'{state,format}' IS DISTINCT FROM 'courseforge-html-editable-override-state-v1'
    OR p_revision#>'{state,overrides}' IS DISTINCT FROM '[]'::jsonb
    OR p_revision#>'{manifest,elements}' IS DISTINCT FROM pilot#>'{candidate,template,elements}'
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_revisions r JOIN public.video_composition_drafts draft ON draft.composition_id = r.composition_id
    WHERE draft.id = p_draft_id AND draft.organization_id = p_organization_id AND r.organization_id = p_organization_id
      AND r.id::text = binding->>'revisionId' FOR SHARE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_UNAVAILABLE'; END IF;
  grants := private.html_editing_grants(p_organization_id,p_draft_id,p_revision);
  IF EXISTS (SELECT 1 FROM unnest(p_used_asset_ids) used(id) WHERE NOT (grants ? used.id::text))
    THEN RAISE EXCEPTION 'HTML_EDITING_ASSET_NOT_AUTHORIZED'; END IF;
  reference := jsonb_build_object('clipId',p_clip_id,'revisionVersion',1,'revisionSha256',p_revision_sha256,
    'templateId',binding->>'templateId','templateVersion',(binding->>'templateVersion')::integer,
    'sourceSha256',binding->>'sourceSha256','manifestSha256',binding->>'manifestSha256');
  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'clipId') COLLATE "C"),'[]'::jsonb) INTO references_json FROM (
    SELECT item FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) item UNION ALL SELECT reference
  ) assembled;
  SELECT jsonb_agg(CASE WHEN c->>'id' = p_clip_id THEN jsonb_set(c,'{source,html}',to_jsonb(p_revision->>'sourceHtml')) ELSE c END ORDER BY position)
    INTO clips_json FROM jsonb_array_elements(d.document->'clips') WITH ORDINALITY AS clips(c,position);
  expected_document := jsonb_set(jsonb_set(jsonb_set(d.document,'{format}','"courseforge-composition-v4"'::jsonb),'{clips}',clips_json),
    '{htmlEditing}',jsonb_build_object('format','courseforge-html-editable-references-v1','items',references_json));
  IF p_document IS DISTINCT FROM expected_document OR p_document_hash = d.document_hash
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_INVALID'; END IF;
  -- Reuse, do not modify, the existing native append/audit implementation. This
  -- call and all inserts below run inside ONE RPC transaction and root lock.
  SELECT * INTO append_result FROM public.append_video_composition_draft_document_v2(p_draft_id,p_organization_id,
    d.document_hash,p_document,p_document_hash,'courseforge-composition-v4',p_actor_id,'USER',
    'Adoptó un candidato HTML legado revisado.',jsonb_build_object('operation','HTML_LEGACY_ADOPTION','clipId',p_clip_id,
      'candidateId',candidate.candidate_id,'provenanceSha256',p_request->>'provenanceSha256',
      'originalSourceSha256',candidate.candidate->>'originalSourceSha256','reviewEvidenceSha256',candidate.candidate#>>'{approval,evidenceSha256}'));
  IF append_result.outcome IS DISTINCT FROM 'APPENDED' OR append_result.document_hash IS DISTINCT FROM p_document_hash
    THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_UNCONFIRMED'; END IF;
  INSERT INTO private.composition_html_templates(organization_id,draft_id,clip_id,initial_revision)
    VALUES(p_organization_id,p_draft_id,p_clip_id,p_revision);
  INSERT INTO private.composition_html_revisions(organization_id,draft_id,clip_id,version,revision,sha256,created_by)
    VALUES(p_organization_id,p_draft_id,p_clip_id,1,p_revision,p_revision_sha256,p_actor_id);
  result_receipt := jsonb_build_object('scope','HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED',
    'owner',jsonb_build_object('actorId',p_actor_id,'organizationId',p_organization_id,'draftId',p_draft_id),
    'clipId',p_clip_id,'operationId',p_operation_id,'requestSha256',p_request_sha256,'request',p_request,
    'acknowledgment',jsonb_build_object('status','CONFIRMED','compositionDocumentHash',p_document_hash,
      'compositionDocumentVersion',append_result.version,'revisionVersion',1,'revisionSha256',p_revision_sha256));
  INSERT INTO private.composition_html_legacy_adoption_receipts(organization_id,draft_id,actor_id,operation_id,clip_id,
    candidate_id,request_sha256,receipt,used_asset_ids)
    VALUES(p_organization_id,p_draft_id,p_actor_id,p_operation_id,p_clip_id,candidate.candidate_id,p_request_sha256,result_receipt,p_used_asset_ids);
  RETURN result_receipt;
END $$;

CREATE FUNCTION public.read_html_editing_legacy_adoption_operation(p_organization_id uuid,p_draft_id uuid,p_clip_id text,
  p_actor_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_legacy_adoption_receipts%ROWTYPE; candidate jsonb;
  template private.composition_html_templates%ROWTYPE; grants jsonb;
BEGIN
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id
    AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO stored FROM private.composition_html_legacy_adoption_receipts WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND actor_id = p_actor_id AND operation_id = p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_FOUND'); END IF;
  IF stored.clip_id IS DISTINCT FROM p_clip_id THEN RAISE EXCEPTION 'HTML_LEGACY_ADOPTION_ID_REUSED'; END IF;
  candidate := public.read_html_editing_legacy_candidate(p_organization_id,p_draft_id,p_clip_id,p_actor_id,stored.candidate_id);
  SELECT * INTO template FROM private.composition_html_templates WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  grants := private.html_editing_grants(p_organization_id,p_draft_id,template.initial_revision);
  IF EXISTS (SELECT 1 FROM unnest(stored.used_asset_ids) used(id) WHERE NOT (grants ? used.id::text))
    THEN RAISE EXCEPTION 'HTML_EDITING_ASSET_NOT_AUTHORIZED'; END IF;
  RETURN jsonb_build_object('status','RECORDED','receipt',stored.receipt);
END $$;

REVOKE ALL ON FUNCTION public.record_html_editing_legacy_candidate(uuid,uuid,text,uuid,jsonb),
  public.read_html_editing_legacy_candidate(uuid,uuid,text,uuid,uuid),
  public.revoke_html_editing_legacy_candidate(uuid,uuid,text,uuid,uuid),
  public.commit_html_editing_legacy_adoption(uuid,uuid,text,uuid,uuid,text,jsonb,jsonb,text,jsonb,text,uuid[]),
  public.read_html_editing_legacy_adoption_operation(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_html_editing_legacy_candidate(uuid,uuid,text,uuid,jsonb),
  public.read_html_editing_legacy_candidate(uuid,uuid,text,uuid,uuid),
  public.revoke_html_editing_legacy_candidate(uuid,uuid,text,uuid,uuid),
  public.commit_html_editing_legacy_adoption(uuid,uuid,text,uuid,uuid,text,jsonb,jsonb,text,jsonb,text,uuid[]),
  public.read_html_editing_legacy_adoption_operation(uuid,uuid,text,uuid,uuid) TO service_role;
COMMIT;
