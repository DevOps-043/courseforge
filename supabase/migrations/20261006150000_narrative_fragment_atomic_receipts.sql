-- PREPARED ONLY: apply only after PostgreSQL integration validation; keep audiovisual writes disabled.
-- Additive rollback: disable new writes, retain receipts and recovery; never delete committed history.
BEGIN;
CREATE TABLE public.narrative_fragment_receipts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  command_id uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  document_id uuid NOT NULL REFERENCES public.video_composition_draft_documents(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,draft_id,actor_id,command_id)
);
ALTER TABLE public.narrative_fragment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.narrative_fragment_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_narrative_fragment_receipt(p_draft_id uuid,p_organization_id uuid,p_actor_id uuid,p_command_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT receipt FROM public.narrative_fragment_receipts WHERE draft_id=p_draft_id AND organization_id=p_organization_id
    AND actor_id=p_actor_id AND command_id=p_command_id;
$$;
REVOKE ALL ON FUNCTION public.read_narrative_fragment_receipt(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_narrative_fragment_receipt(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.commit_narrative_fragment(p_draft_id uuid,p_organization_id uuid,p_actor_id uuid,p_command_id uuid,
  p_request_fingerprint text,p_plan jsonb,p_document jsonb,p_document_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  draft public.video_composition_drafts%ROWTYPE; current_doc public.video_composition_draft_documents%ROWTYPE;
  prior public.narrative_fragment_receipts%ROWTYPE; component_id uuid; retained jsonb; resources_status text;
  appended record; saved_document_id uuid; receipt_json jsonb; new_ids jsonb;
BEGIN
  IF p_draft_id IS NULL OR p_organization_id IS NULL OR p_actor_id IS NULL OR p_command_id IS NULL
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_plan IS NULL OR p_document IS NULL OR octet_length(p_plan::text)>1048576 OR octet_length(p_document::text)>16777216
    OR p_plan->>'contract' IS DISTINCT FROM 'NARRATIVE_AUDIOVISUAL_FRAGMENT_PLAN_V1'
    OR p_plan->>'scope' IS DISTINCT FROM 'AUDIOVISUAL' OR p_plan->>'binding' IS DISTINCT FROM 'REGISTRY_METADATA_MATCH_ONLY'
    OR p_plan->>'documentHash' IS NULL OR p_plan->>'documentHash' !~ '^[a-f0-9]{64}$'
    OR p_plan#>>'{anchor,newClipId}' IS DISTINCT FROM 'voice-extract-'||p_command::text
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_REQUEST_INVALID'; END IF;
  -- Service-only caller must reauthorize actor/tenant/role on every apply and recovery request.
  -- Same draft-first lock order as the native document gateway. No remote work within this transaction.
  SELECT * INTO draft FROM public.video_composition_drafts WHERE id=p_draft_id AND organization_id=p_organization_id FOR UPDATE NOWAIT;
  IF draft.id IS NULL THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT * INTO prior FROM public.narrative_fragment_receipts WHERE organization_id=p_organization_id AND draft_id=p_draft_id
    AND actor_id=p_actor_id AND command_id=p_command_id;
  IF prior.command_id IS NOT NULL THEN
    IF prior.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN RETURN jsonb_build_object('status','COMMAND_REUSED'); END IF;
    RETURN jsonb_build_object('status','REPLAYED','receipt',prior.receipt);
  END IF;
  IF draft.state IS DISTINCT FROM 'ACTIVE' THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT * INTO current_doc FROM public.video_composition_draft_documents WHERE draft_id=p_draft_id AND organization_id=p_organization_id
    ORDER BY version DESC LIMIT 1;
  IF current_doc.id IS NULL OR current_doc.document_hash IS DISTINCT FROM p_plan->>'documentHash'
    THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT material_component_id INTO component_id FROM public.video_compositions WHERE id=draft.composition_id AND organization_id=p_organization_id FOR SHARE NOWAIT;
  IF component_id IS NULL THEN RETURN jsonb_build_object('status','ASSET_CHANGED'); END IF;
  retained := private.narrative_fragment_document_delta(current_doc.document,p_plan,p_document,p_command_id);
  resources_status := private.validate_narrative_fragment_resources(p_organization_id,p_draft_id,component_id,current_doc.document,p_plan,retained);
  IF resources_status IN ('ASSET_CHANGED','FONT_CHANGED') THEN RETURN jsonb_build_object('status',resources_status); END IF;
  IF resources_status IS DISTINCT FROM 'OK' THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_RESOURCES_UNCONFIRMED'; END IF;
  SELECT * INTO appended FROM public.append_video_composition_draft_document_v2(p_draft_id,p_organization_id,current_doc.document_hash,
    p_document,p_document_hash,p_document->>'format',p_actor_id,'USER','Extraer fragmento audiovisual al final',
    jsonb_build_object('commandId',p_command_id,'sourceClipId',p_plan#>>'{anchor,sourceClipId}',
      'clipCount',jsonb_array_length(p_plan->'copies'),'operations',jsonb_build_array('composition.canvas-duration','clip.add','group.create')));
  IF appended.outcome IS DISTINCT FROM 'APPENDED' THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_APPEND_UNCONFIRMED'; END IF;
  SELECT id INTO saved_document_id FROM public.video_composition_draft_documents WHERE draft_id=p_draft_id AND organization_id=p_organization_id AND version=appended.version;
  SELECT jsonb_agg(c->'newClipId' ORDER BY ordinal) INTO new_ids FROM jsonb_array_elements(p_plan->'copies') WITH ORDINALITY copied(c,ordinal);
  receipt_json := jsonb_build_object('contract','NARRATIVE_FRAGMENT_RECEIPT_V1','commandId',p_command_id,
    'requestFingerprint',p_request_fingerprint,'documentHash',appended.document_hash,'version',appended.version,
    'anchorClipId',p_plan#>>'{anchor,newClipId}','newClipIds',new_ids);
  INSERT INTO public.narrative_fragment_receipts(organization_id,draft_id,actor_id,command_id,request_fingerprint,document_id,receipt)
    VALUES(p_organization_id,p_draft_id,p_actor_id,p_command_id,p_request_fingerprint,saved_document_id,receipt_json);
  RETURN jsonb_build_object('status','COMMITTED','receipt',receipt_json);
EXCEPTION WHEN lock_not_available THEN
  -- The enclosing PL/pgSQL exception block rolls back all writes before BUSY can be returned.
  RETURN jsonb_build_object('status','BUSY');
END $$;
REVOKE ALL ON FUNCTION public.commit_narrative_fragment(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_narrative_fragment(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) TO service_role;
COMMIT;
