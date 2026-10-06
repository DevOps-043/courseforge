-- PREPARED ONLY: do not apply or enable extraction writes before integration review.
-- Additive; rollback is disabling the unused RPCs, not deleting committed receipts/history.
BEGIN;
CREATE TABLE public.narrative_extraction_receipts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  -- Immutable actor namespace survives profile deletion; document audit keeps its existing FK behavior.
  actor_id uuid NOT NULL,
  command_id uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  document_id uuid NOT NULL REFERENCES public.video_composition_draft_documents(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, draft_id, actor_id, command_id)
);
ALTER TABLE public.narrative_extraction_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.narrative_extraction_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.read_narrative_extraction_receipt(p_draft_id uuid,p_organization_id uuid,p_actor_id uuid,p_command_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT receipt FROM public.narrative_extraction_receipts
  WHERE draft_id=p_draft_id AND organization_id=p_organization_id AND actor_id=p_actor_id AND command_id=p_command_id;
$$;
REVOKE ALL ON FUNCTION public.read_narrative_extraction_receipt(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_narrative_extraction_receipt(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.commit_narrative_voice_extraction(p_draft_id uuid,p_organization_id uuid,p_actor_id uuid,
  p_command_id uuid,p_request_fingerprint text,p_plan jsonb,p_document jsonb,p_document_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  draft public.video_composition_drafts%ROWTYPE;
  current_doc public.video_composition_draft_documents%ROWTYPE;
  asset public.production_assets%ROWTYPE;
  prior public.narrative_extraction_receipts%ROWTYPE;
  component_id uuid; clip jsonb; track jsonb; scene jsonb; copied_clip jsonb; expected_doc jsonb;
  source_start numeric; source_end numeric; duration numeric; destination_start numeric; destination_end numeric;
  appended record; saved_document_id uuid; receipt_json jsonb;
BEGIN
  IF p_draft_id IS NULL OR p_organization_id IS NULL OR p_actor_id IS NULL OR p_command_id IS NULL
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[a-f0-9]{64}$'
    OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$'
    OR p_plan IS NULL OR p_document IS NULL OR octet_length(p_document::text)>16777216
    OR octet_length(p_plan::text)>1048576
    OR p_plan->>'contract' IS DISTINCT FROM 'NARRATIVE_VOICE_EXTRACTION_PLAN_V1'
    OR p_plan->>'scope' IS DISTINCT FROM 'VOICE_ONLY'
    OR p_plan->>'binding' IS DISTINCT FROM 'REGISTRY_METADATA_MATCH_ONLY'
    OR p_plan->>'documentHash' IS NULL OR p_plan->>'documentHash' !~ '^[a-f0-9]{64}$'
    OR p_plan->>'sourceChecksum' IS NULL OR p_plan->>'sourceChecksum' !~ '^[a-f0-9]{64}$'
    OR p_plan->>'sourceScriptHash' IS NULL OR p_plan->>'sourceScriptHash' !~ '^[a-f0-9]{64}$'
    OR p_plan->>'newClipId' IS DISTINCT FROM 'voice-extract-'||p_command_id::text
    THEN RAISE EXCEPTION 'NARRATIVE_EXTRACTION_REQUEST_INVALID'; END IF;
  -- Caller is service-only and must reauthorize tenant/role for every apply/recovery request.
  -- Same draft-first lock order as the native append gateway; never hold a remote/network operation here.
  BEGIN
    SELECT * INTO draft FROM public.video_composition_drafts
      WHERE id=p_draft_id AND organization_id=p_organization_id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','BUSY'); END;
  IF draft.id IS NULL THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT * INTO prior FROM public.narrative_extraction_receipts WHERE organization_id=p_organization_id
    AND draft_id=p_draft_id AND actor_id=p_actor_id AND command_id=p_command_id;
  IF prior.command_id IS NOT NULL THEN
    IF prior.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN RETURN jsonb_build_object('status','COMMAND_REUSED'); END IF;
    RETURN jsonb_build_object('status','REPLAYED','receipt',prior.receipt);
  END IF;
  IF draft.state IS DISTINCT FROM 'ACTIVE' THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT * INTO current_doc FROM public.video_composition_draft_documents
    WHERE draft_id=p_draft_id AND organization_id=p_organization_id ORDER BY version DESC LIMIT 1;
  IF current_doc.id IS NULL OR current_doc.document_hash IS DISTINCT FROM p_plan->>'documentHash'
    THEN RETURN jsonb_build_object('status','CONFLICT'); END IF;
  SELECT material_component_id INTO component_id FROM public.video_compositions
    WHERE id=draft.composition_id AND organization_id=p_organization_id FOR SHARE NOWAIT;
  IF component_id IS NULL THEN RETURN jsonb_build_object('status','ASSET_CHANGED'); END IF;
  -- SHARE locks block deletion AND non-key updates (e.g. QA/checksum/metadata), unlike KEY SHARE.
  PERFORM 1 FROM public.video_composition_draft_assets WHERE draft_id=p_draft_id AND organization_id=p_organization_id
    AND production_asset_id=(p_plan->>'sourceAssetId')::uuid FOR SHARE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','ASSET_CHANGED'); END IF;
  SELECT * INTO asset FROM public.production_assets WHERE id=(p_plan->>'sourceAssetId')::uuid
    AND organization_id=p_organization_id AND material_component_id=component_id FOR SHARE NOWAIT;
  IF asset.id IS NULL OR asset.asset_type IS DISTINCT FROM 'VOICE_AUDIO'
    OR asset.mime_type IS NULL OR asset.mime_type !~ '^audio/'
    OR asset.checksum IS DISTINCT FROM p_plan->>'sourceChecksum'
    OR asset.qa_status IS DISTINCT FROM p_plan->>'sourceQaStatus'
    OR asset.qa_status NOT IN ('READY_FOR_QA','APPROVED','EXPORTED','PUBLISHED')
    OR asset.duration_milliseconds IS DISTINCT FROM (p_plan->>'sourceDurationMilliseconds')::bigint
    OR asset.duration_milliseconds IS NULL OR asset.duration_milliseconds<=0
    OR asset.metadata->>'script_hash' IS DISTINCT FROM p_plan->>'sourceScriptHash'
    THEN RETURN jsonb_build_object('status','ASSET_CHANGED'); END IF;
  SELECT item INTO clip FROM jsonb_array_elements(current_doc.document->'clips') item WHERE item->>'id'=p_plan->>'sourceClipId';
  SELECT item INTO track FROM jsonb_array_elements(current_doc.document->'tracks') item WHERE item->>'id'=clip->>'trackId';
  SELECT item INTO scene FROM jsonb_array_elements(current_doc.document->'narrativeScenes') item WHERE item->>'id'=clip->>'sceneId';
  IF clip IS NULL OR track IS NULL OR scene IS NULL OR clip->>'kind' IS DISTINCT FROM 'AUDIO'
    OR clip#>>'{source,type}' IS DISTINCT FROM 'PRODUCTION_ASSET'
    OR clip#>>'{source,productionAssetId}' IS DISTINCT FROM asset.id::text
    OR track->>'semanticRole' IS DISTINCT FROM 'VOICE' OR coalesce((track->>'locked')::boolean,false)
    OR coalesce((clip->>'hidden')::boolean,false) OR coalesce((track->>'hidden')::boolean,false)
    OR coalesce((clip->>'playbackRate')::numeric,1)<>1 OR coalesce((clip->>'freezeTailSeconds')::numeric,0)<>0
    OR coalesce((clip->>'fadeInSeconds')::numeric,0)>0 OR coalesce((clip->>'fadeOutSeconds')::numeric,0)>0
    OR scene->>'scriptHash' IS DISTINCT FROM asset.metadata->>'script_hash'
    OR scene->'wordTimestamps' IS DISTINCT FROM asset.metadata->'word_timestamps'
    THEN RETURN jsonb_build_object('status','ASSET_CHANGED'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(current_doc.document->'groups','[]'::jsonb)) item
      WHERE item->'clipIds' ? (clip->>'id'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(current_doc.document#>'{motion,animations}','[]'::jsonb)) item
      WHERE item#>>'{target,clipId}'=clip->>'id')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(current_doc.document#>'{transitions,items}','[]'::jsonb)) item
      WHERE item->>'fromClipId'=clip->>'id' OR item->>'toClipId'=clip->>'id')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(current_doc.document->'clips') other_clip,
      jsonb_array_elements(current_doc.document->'tracks') other_track
      WHERE other_clip->>'sceneId'=clip->>'sceneId' AND other_clip->>'trackId'=other_track->>'id'
        AND other_track->>'semanticRole'='AVATAR')
    THEN RETURN jsonb_build_object('status','ASSET_CHANGED'); END IF;
  source_start := (p_plan->>'sourceStartSeconds')::numeric; source_end := (p_plan->>'sourceEndSeconds')::numeric;
  -- Use the server reducer's duration to avoid decimal/IEEE-754 cancellation changing an exact copied field.
  duration := (p_plan#>>'{operations,1,clip,durationSeconds}')::numeric;
  destination_start := (current_doc.document#>>'{canvas,durationSeconds}')::numeric;
  destination_end := (p_plan->>'destinationEndSeconds')::numeric;
  IF source_start IS NULL OR source_end IS NULL OR destination_start IS NULL OR destination_end IS NULL
    OR duration IS NULL OR source_start<0 OR duration<=0 OR duration>120
    OR abs(source_end-source_start-duration)>0.000001
    OR source_start<coalesce((clip->>'sourceOffsetSeconds')::numeric,0)
    OR source_end>coalesce((clip->>'sourceOffsetSeconds')::numeric,0)+(clip->>'durationSeconds')::numeric
    OR source_end>asset.duration_milliseconds::numeric/1000
    OR (p_plan->>'destinationStartSeconds')::numeric IS DISTINCT FROM destination_start
    OR abs(destination_end-destination_start-duration)>0.000001
    THEN RAISE EXCEPTION 'NARRATIVE_EXTRACTION_INTERVAL_INVALID'; END IF;
  copied_clip := (clip-'sceneId')||jsonb_build_object('id',p_plan->>'newClipId','hfId','hf-voice-extract-'||p_command_id::text,
    'label',left(clip->>'label',90)||' · fragmento de voz','startSeconds',destination_start,
    'durationSeconds',duration,'sourceOffsetSeconds',source_start,'sourceDurationSeconds',asset.duration_milliseconds::numeric/1000,
    'timingSource','USER_EDITED');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(current_doc.document->'clips') existing
    WHERE existing->>'id'=copied_clip->>'id' OR existing->>'hfId'=copied_clip->>'hfId')
    THEN RAISE EXCEPTION 'NARRATIVE_EXTRACTION_CLIP_COLLISION'; END IF;
  expected_doc := jsonb_set(jsonb_set(jsonb_set(current_doc.document,'{canvas,durationSeconds}',to_jsonb(destination_end)),
    '{canvas,durationMode}','"USER_EDITED"'::jsonb),'{clips}',(current_doc.document->'clips')||jsonb_build_array(copied_clip));
  -- Exact append-only delta: cannot drop originals, mutate HTML pointers, or alter unrelated fields.
  -- Legacy documents that need normalization fail closed until explicitly reconciled.
  IF p_document IS DISTINCT FROM expected_doc THEN RAISE EXCEPTION 'NARRATIVE_EXTRACTION_DOCUMENT_INVALID'; END IF;
  SELECT * INTO appended FROM public.append_video_composition_draft_document_v2(p_draft_id,p_organization_id,
    current_doc.document_hash,p_document,p_document_hash,p_document->>'format',p_actor_id,'USER','Extraer fragmento de voz al final',
    jsonb_build_object('commandId',p_command_id,'sourceClipId',clip->>'id','operations',jsonb_build_array('composition.canvas-duration','clip.add')));
  IF appended.outcome IS DISTINCT FROM 'APPENDED' THEN RAISE EXCEPTION 'NARRATIVE_EXTRACTION_APPEND_UNCONFIRMED'; END IF;
  SELECT id INTO saved_document_id FROM public.video_composition_draft_documents
    WHERE draft_id=p_draft_id AND organization_id=p_organization_id AND version=appended.version;
  receipt_json := jsonb_build_object('commandId',p_command_id,'requestFingerprint',p_request_fingerprint,
    'documentHash',appended.document_hash,'version',appended.version,'newClipId',p_plan->>'newClipId');
  INSERT INTO public.narrative_extraction_receipts(organization_id,draft_id,actor_id,command_id,request_fingerprint,document_id,receipt)
    VALUES(p_organization_id,p_draft_id,p_actor_id,p_command_id,p_request_fingerprint,saved_document_id,receipt_json);
  RETURN jsonb_build_object('status','COMMITTED','receipt',receipt_json);
EXCEPTION WHEN lock_not_available THEN
  -- PL/pgSQL exception block rolls back its writes before returning BUSY.
  RETURN jsonb_build_object('status','BUSY');
END $$;
REVOKE ALL ON FUNCTION public.commit_narrative_voice_extraction(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_narrative_voice_extraction(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text) TO service_role;
COMMIT;
