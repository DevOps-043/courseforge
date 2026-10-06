-- PREPARED ONLY. Requires the durable host/HTTP/client release; do not apply alone.
BEGIN;
CREATE TABLE private.composition_html_operation_receipts (
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
ALTER TABLE private.composition_html_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_html_operation_receipts FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE private.composition_html_operation_receipts IS
  'Immutable editorial result metadata, not current/render authority. Retain with draft; never expire into retry eligibility.';

CREATE FUNCTION public.commit_html_editing_operation(
  p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,
  p_operation_id uuid,p_request_sha256 text,p_changed boolean,
  p_expected_version integer,p_expected_sha256 text,p_expected_document_hash text,
  p_binding jsonb,p_revision jsonb,p_revision_sha256 text,p_document jsonb,p_document_hash text,
  p_used_asset_ids jsonb,p_operation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_operation_receipts%ROWTYPE;
  d public.video_composition_draft_documents%ROWTYPE;
  t private.composition_html_templates%ROWTYPE;
  r private.composition_html_revisions%ROWTYPE;
  append_result jsonb; result_receipt jsonb; grants jsonb; current_reference jsonb;
BEGIN
  IF p_operation_id IS NULL OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[a-f0-9]{64}$'
    OR p_changed IS NULL OR p_operation IS NULL OR p_operation NOT IN ('COMMAND','RESTORE')
    OR p_expected_version IS NULL OR p_expected_version NOT BETWEEN 1 AND 1000000
    OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[a-f0-9]{64}$'
    OR p_expected_document_hash IS NULL OR p_expected_document_hash !~ '^[a-f0-9]{64}$'
    OR p_revision_sha256 IS NULL OR p_revision_sha256 !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_binding IS NULL OR p_revision IS NULL OR p_document IS NULL OR p_used_asset_ids IS NULL
    OR jsonb_typeof(p_used_asset_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_used_asset_ids) > 6400
    OR octet_length(p_revision::text) > 1048576 OR octet_length(p_document::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_EDITING_OPERATION_INVALID'; END IF;
  -- Draft-first, same order as native append. No indefinite contention waits.
  BEGIN
    PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id
      AND organization_id = p_organization_id AND state = 'ACTIVE' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RAISE EXCEPTION 'HTML_EDITING_OPERATION_CONFLICT'; END;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  SELECT * INTO t FROM private.composition_html_templates WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND NOT revoked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  SELECT * INTO stored FROM private.composition_html_operation_receipts
    WHERE organization_id = p_organization_id AND draft_id = p_draft_id
      AND actor_id = p_actor_id AND operation_id = p_operation_id;
  IF FOUND THEN
    IF stored.clip_id IS DISTINCT FROM p_clip_id OR stored.request_sha256 IS DISTINCT FROM p_request_sha256
      THEN RAISE EXCEPTION 'HTML_EDITING_OPERATION_ID_REUSED'; END IF;
    -- Historical receipt only: never append/reactivate an already recorded ID.
    RETURN stored.receipt;
  END IF;
  IF p_changed THEN
    append_result := public.append_html_editing_revision(p_organization_id,p_draft_id,p_clip_id,p_actor_id,
      p_expected_version,p_expected_sha256,p_expected_document_hash,p_binding,p_revision,
      p_revision_sha256,p_document,p_document_hash,p_used_asset_ids,p_operation);
    IF append_result->>'status' IS DISTINCT FROM 'COMMITTED'
      THEN RAISE EXCEPTION 'HTML_EDITING_OPERATION_CONFLICT'; END IF;
  ELSE
    SELECT * INTO d FROM public.video_composition_draft_documents WHERE organization_id = p_organization_id
      AND draft_id = p_draft_id ORDER BY version DESC LIMIT 1;
    SELECT * INTO r FROM private.composition_html_revisions WHERE organization_id = p_organization_id
      AND draft_id = p_draft_id AND clip_id = p_clip_id ORDER BY version DESC LIMIT 1;
    IF d.id IS NULL OR r.draft_id IS NULL OR d.document_hash IS DISTINCT FROM p_expected_document_hash
      OR r.version IS DISTINCT FROM p_expected_version OR r.sha256 IS DISTINCT FROM p_expected_sha256
      OR p_document IS DISTINCT FROM d.document OR p_document_hash IS DISTINCT FROM d.document_hash
      OR p_revision IS DISTINCT FROM r.revision OR p_revision_sha256 IS DISTINCT FROM r.sha256
      OR p_binding IS DISTINCT FROM t.initial_revision#>'{manifest,binding}'
      THEN RAISE EXCEPTION 'HTML_EDITING_OPERATION_CONFLICT'; END IF;
    SELECT item INTO current_reference FROM jsonb_array_elements(coalesce(d.document#>'{htmlEditing,items}','[]'::jsonb)) item
      WHERE item->>'clipId' = p_clip_id;
    IF (current_reference IS NULL AND r.version <> 1) OR (current_reference IS NOT NULL AND
      (current_reference->>'revisionVersion' IS DISTINCT FROM r.version::text
       OR current_reference->>'revisionSha256' IS DISTINCT FROM r.sha256))
      THEN RAISE EXCEPTION 'HTML_EDITING_REFERENCE_INVALID'; END IF;
    grants := private.html_editing_grants(p_organization_id,p_draft_id,t.initial_revision);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_used_asset_ids) used(id) WHERE NOT (grants ? used.id))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_revision#>'{state,overrides}') item
        WHERE item->>'operation' = 'SET_IMAGE' AND NOT (grants ? (item->>'assetId')))
      THEN RAISE EXCEPTION 'HTML_EDITING_ASSET_NOT_AUTHORIZED'; END IF;
  END IF;
  result_receipt := jsonb_build_object('scope','EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED',
    'owner',jsonb_build_object('actorId',p_actor_id,'organizationId',p_organization_id,'draftId',p_draft_id),
    'operationId',p_operation_id,'requestSha256',p_request_sha256,'clipId',p_clip_id,
    'acknowledgment',jsonb_build_object('scope','EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED',
      'changed',p_changed,'previous',jsonb_build_object('version',p_expected_version,'sha256',p_expected_sha256),
      'next',jsonb_build_object('version',CASE WHEN p_changed THEN p_expected_version + 1 ELSE p_expected_version END,
        'sha256',p_revision_sha256)));
  -- Receipt failure rolls back native append, audit and HTML revision as well.
  INSERT INTO private.composition_html_operation_receipts(organization_id,draft_id,actor_id,operation_id,clip_id,request_sha256,receipt)
    VALUES(p_organization_id,p_draft_id,p_actor_id,p_operation_id,p_clip_id,p_request_sha256,result_receipt);
  RETURN result_receipt;
END $$;
REVOKE ALL ON FUNCTION public.commit_html_editing_operation(uuid,uuid,text,uuid,uuid,text,boolean,integer,text,text,jsonb,jsonb,text,jsonb,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_html_editing_operation(uuid,uuid,text,uuid,uuid,text,boolean,integer,text,text,jsonb,jsonb,text,jsonb,text,jsonb,text) TO service_role;

CREATE FUNCTION public.read_html_editing_operation(p_organization_id uuid,p_draft_id uuid,p_clip_id text,p_actor_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE stored private.composition_html_operation_receipts%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'HTML_EDITING_OPERATION_INVALID'; END IF;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = p_draft_id AND organization_id = p_organization_id
    AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_DRAFT_INVALID'; END IF;
  PERFORM private.assert_html_editing_actor(p_organization_id,p_actor_id);
  PERFORM 1 FROM private.composition_html_templates WHERE organization_id = p_organization_id AND draft_id = p_draft_id
    AND clip_id = p_clip_id AND NOT revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HTML_EDITING_TEMPLATE_INVALID'; END IF;
  SELECT * INTO stored FROM private.composition_html_operation_receipts WHERE organization_id = p_organization_id
    AND draft_id = p_draft_id AND clip_id = p_clip_id AND actor_id = p_actor_id AND operation_id = p_operation_id;
  IF NOT FOUND THEN
    -- Missing receipt does NOT establish that a dispatch failed or may be retried.
    RETURN jsonb_build_object('status','NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('status','RECORDED','receipt',stored.receipt);
END $$;
REVOKE ALL ON FUNCTION public.read_html_editing_operation(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_html_editing_operation(uuid,uuid,text,uuid,uuid) TO service_role;
COMMIT;
