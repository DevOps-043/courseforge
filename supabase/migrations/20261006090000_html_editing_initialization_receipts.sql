-- PREPARED ONLY. Requires matching server/client receipt release; do not apply alone.
BEGIN;
CREATE TABLE private.composition_html_initialization_receipts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  operation_id uuid NOT NULL,
  clip_id text NOT NULL CHECK (clip_id ~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (octet_length(receipt::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,draft_id,actor_id,operation_id),
  FOREIGN KEY (draft_id,clip_id) REFERENCES private.composition_html_templates(draft_id,clip_id)
);
ALTER TABLE private.composition_html_initialization_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_initialization_receipts FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.composition_html_initialization_receipts IS
  'Immutable initialization result metadata, not current/render authority. Retain with draft; absence never grants retry permission.';

CREATE FUNCTION public.commit_html_editing_initialization_operation(
  p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,
  p_operation_id uuid,p_request_sha256 text,p_expected_document_hash text,
  p_revision jsonb,p_revision_sha256 text,p_used_asset_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_initialization_receipts%ROWTYPE;
  t private.composition_html_templates%ROWTYPE; r private.composition_html_revisions%ROWTYPE;
  created boolean; result_receipt jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_clip_id IS NULL OR p_clip_id !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'
    OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_document_hash IS NULL OR p_expected_document_hash !~ '^[a-f0-9]{64}$'
    OR p_revision_sha256 IS NULL OR p_revision_sha256 !~ '^[a-f0-9]{64}$'
    OR p_revision IS NULL OR octet_length(p_revision::text) > 1048576
    OR p_revision->>'version' IS DISTINCT FROM '1'
    OR p_revision#>>'{manifest,binding,documentSha256}' IS DISTINCT FROM p_expected_document_hash
    OR p_revision#>>'{manifest,binding,templateId}' IS NULL
    OR p_revision#>>'{manifest,binding,templateVersion}' IS NULL
    OR p_used_asset_ids IS NULL OR cardinality(p_used_asset_ids) > 6400
    OR array_position(p_used_asset_ids,NULL) IS NOT NULL
    THEN RAISE EXCEPTION 'HTML_INITIALIZATION_OPERATION_INVALID'; END IF;
  -- Same draft-root lock order as registration/native writes, bounded contention.
  BEGIN
    PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id
      AND organization_id = p_organization_id AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'HTML_INITIALIZATION_OPERATION_CONFLICT'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO stored FROM private.composition_html_initialization_receipts
    WHERE organization_id = p_organization_id AND draft_id = p_draft_id
      AND actor_id = p_actor_id AND operation_id = p_operation_id;
  IF FOUND THEN
    IF stored.clip_id IS DISTINCT FROM p_clip_id OR stored.request_sha256 IS DISTINCT FROM p_request_sha256
      OR stored.receipt#>>'{request,expectedDocumentHash}' IS DISTINCT FROM p_expected_document_hash
      OR stored.receipt#>>'{request,templateId}' IS DISTINCT FROM p_revision#>>'{manifest,binding,templateId}'
      OR stored.receipt#>>'{request,templateVersion}' IS DISTINCT FROM p_revision#>>'{manifest,binding,templateVersion}'
      OR stored.receipt#>>'{acknowledgment,sha256}' IS DISTINCT FROM p_revision_sha256
      THEN RAISE EXCEPTION 'HTML_INITIALIZATION_OPERATION_ID_REUSED'; END IF;
    PERFORM 1 FROM private.composition_html_templates WHERE organization_id = p_organization_id
      AND draft_id = p_draft_id AND clip_id = p_clip_id AND NOT revoked FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
    -- Historical only. No registration, append, native write or reactivation.
    RETURN stored.receipt;
  END IF;
  created := public.register_html_editing_template_v2(p_organization_id,p_draft_id,p_actor_id,p_clip_id,
    p_expected_document_hash,p_revision,p_revision_sha256,p_used_asset_ids);
  SELECT * INTO t FROM private.composition_html_templates WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND NOT revoked;
  SELECT * INTO r FROM private.composition_html_revisions WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND version = 1;
  IF created IS NULL OR t.draft_id IS NULL OR r.draft_id IS NULL
    OR t.initial_revision IS DISTINCT FROM p_revision OR r.revision IS DISTINCT FROM p_revision
    OR r.sha256 IS DISTINCT FROM p_revision_sha256 THEN RAISE EXCEPTION 'HTML_INITIALIZATION_OPERATION_UNCONFIRMED'; END IF;
  result_receipt := jsonb_build_object('scope','HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED',
    'owner',jsonb_build_object('actorId',p_actor_id,'organizationId',p_organization_id,'draftId',p_draft_id),
    'operationId',p_operation_id,'requestSha256',p_request_sha256,'clipId',p_clip_id,
    'request',jsonb_build_object('templateId',p_revision#>>'{manifest,binding,templateId}',
      'templateVersion',(p_revision#>>'{manifest,binding,templateVersion}')::integer,'expectedDocumentHash',p_expected_document_hash),
    'acknowledgment',jsonb_build_object('status','CONFIRMED','created',created,'version',1,
      'sha256',p_revision_sha256,'compositionDocumentHash',p_expected_document_hash));
  -- Insert failure rolls back registration and first revision in this transaction.
  INSERT INTO private.composition_html_initialization_receipts(organization_id,draft_id,actor_id,operation_id,clip_id,request_sha256,receipt)
    VALUES(p_organization_id,p_draft_id,p_actor_id,p_operation_id,p_clip_id,p_request_sha256,result_receipt);
  RETURN result_receipt;
END $$;
REVOKE ALL ON FUNCTION public.commit_html_editing_initialization_operation(uuid,uuid,text,uuid,uuid,text,text,jsonb,text,uuid[])
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_html_editing_initialization_operation(uuid,uuid,text,uuid,uuid,text,text,jsonb,text,uuid[]) TO service_role;

CREATE FUNCTION public.read_html_editing_initialization_operation(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_initialization_receipts%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR p_clip_id IS NULL OR p_clip_id !~ '^[a-zA-Z][a-zA-Z0-9_-]{0,95}$'
    THEN RAISE EXCEPTION 'HTML_INITIALIZATION_OPERATION_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id
    AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO stored FROM private.composition_html_initialization_receipts WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND actor_id = p_actor_id AND operation_id = p_operation_id AND clip_id = p_clip_id;
  IF NOT FOUND THEN
    -- Never infer failure/permission to retry, including a never-installed template.
    RETURN jsonb_build_object('status','NOT_FOUND');
  END IF;
  PERFORM 1 FROM private.composition_html_templates WHERE organization_id = p_organization_id AND draft_id = p_draft_id
    AND clip_id = p_clip_id AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  RETURN jsonb_build_object('status','RECORDED','receipt',stored.receipt);
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_initialization_operation(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_initialization_operation(uuid,uuid,text,uuid,uuid) TO service_role;
COMMIT;
