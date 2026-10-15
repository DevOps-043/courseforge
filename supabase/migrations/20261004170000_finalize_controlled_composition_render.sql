-- PREPARED ONLY. Host streams Storage and re-verifies consumed authority before calling this RPC.
-- This commits provenance/import state, not audiovisual conformance or QA approval.
BEGIN;
CREATE FUNCTION public.finalize_controlled_composition_render(p_organization_id uuid, p_request_id uuid,
  p_execution_id uuid, p_revision_id uuid, p_production_job_id uuid, p_receipt_sha256 text,
  p_video_sha256 text, p_size_bytes bigint, p_public_url text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  r public.hyperframes_render_requests%ROWTYPE;
  j public.production_jobs%ROWTYPE;
  e private.composition_render_executions%ROWTYPE;
  v public.video_composition_revisions%ROWTYPE;
  a public.production_assets%ROWTYPE;
  object_path text;
  duration integer;
BEGIN
  IF p_receipt_sha256 IS NULL OR p_receipt_sha256 !~ '^[a-f0-9]{64}$'
    OR p_video_sha256 IS NULL OR p_video_sha256 !~ '^[a-f0-9]{64}$'
    OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 2147483648 THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_INPUT_INVALID';
  END IF;
  -- Same request-first order as issue/consume/cancel; serializes finalizers for one request.
  SELECT * INTO r FROM public.hyperframes_render_requests
    WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.production_job_id IS DISTINCT FROM p_production_job_id
    OR r.composition_revision_id IS DISTINCT FROM p_revision_id OR r.provider_render_id IS NOT NULL
    OR r.cancelled_at IS NOT NULL OR r.provider_status NOT IN ('PENDING','RUNNING','COMPLETED') THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_REQUEST_INVALID';
  END IF;
  SELECT * INTO e FROM private.composition_render_executions WHERE id = p_execution_id
    AND organization_id = p_organization_id AND request_id = p_request_id
    AND revision_id = p_revision_id AND production_job_id = p_production_job_id FOR SHARE;
  IF NOT FOUND OR e.status <> 'CONSUMED' OR e.receipt_sha256 IS DISTINCT FROM p_receipt_sha256
    OR e.receipt#>>'{payload,binding,videoSha256}' IS DISTINCT FROM p_video_sha256
    OR e.receipt#>>'{payload,binding,sizeBytes}' IS DISTINCT FROM p_size_bytes::text THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_RECEIPT_INVALID';
  END IF;
  -- Revocation must still block a retry, even if a previous finalization committed successfully.
  PERFORM 1 FROM private.composition_render_supervisor_keys k
    WHERE k.organization_id = e.organization_id AND k.supervisor_id = e.supervisor_id
      AND k.key_id = e.key_id AND NOT k.revoked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_ISSUER_REVOKED'; END IF;
  SELECT * INTO j FROM public.production_jobs WHERE id = p_production_job_id
    AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND OR j.material_component_id IS NULL OR j.artifact_id IS NULL
    OR j.status NOT IN ('PENDING','QUEUED','RUNNING','SUCCEEDED')
    OR j.input_snapshot->>'render_backend' IS DISTINCT FROM 'CONTROLLED'
    OR j.input_snapshot->>'revision_id' IS DISTINCT FROM p_revision_id::text
    OR j.input_snapshot->>'project_hash' IS DISTINCT FROM e.project_hash THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_JOB_INVALID';
  END IF;
  SELECT * INTO v FROM public.video_composition_revisions WHERE id = p_revision_id
    AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND OR v.project_hash IS DISTINCT FROM e.project_hash
    OR v.manifest->'conformance_contract' IS DISTINCT FROM e.contract
    OR v.manifest->>'draft_document_hash' IS DISTINCT FROM e.document_hash THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_REVISION_INVALID';
  END IF;
  PERFORM 1 FROM public.material_components c JOIN public.material_lessons l ON l.id = c.material_lesson_id
    JOIN public.materials m ON m.id = l.materials_id
    JOIN public.artifacts artifact ON artifact.id = m.artifact_id
    WHERE c.id = j.material_component_id AND artifact.id = j.artifact_id
      AND artifact.organization_id = p_organization_id FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_COMPONENT_INVALID'; END IF;
  object_path := 'organizations/' || p_organization_id::text || '/controlled-renders/'
    || p_request_id::text || '/' || p_execution_id::text || '/' || p_video_sha256 || '.mp4';
  IF p_public_url IS NULL OR p_public_url NOT LIKE ('https://%/storage/v1/object/public/production-videos/' || object_path)
    OR position('?' in p_public_url) > 0 OR position('#' in p_public_url) > 0 THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_URL_INVALID';
  END IF;
  -- Storage metadata is a completeness check only. SHA-256 is measured by the trusted Node host.
  PERFORM 1 FROM storage.objects o WHERE o.bucket_id = 'production-videos' AND o.name = object_path
    AND o.metadata->>'size' = p_size_bytes::text
    AND o.metadata->>'mimetype' = 'video/mp4' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_STORAGE_INCOMPLETE'; END IF;
  SELECT * INTO a FROM public.production_assets WHERE production_job_id = j.id AND asset_type = 'FINAL_VIDEO' FOR UPDATE;
  IF FOUND THEN
    IF j.status <> 'SUCCEEDED' OR r.import_status <> 'COMPLETED' OR r.provider_status <> 'COMPLETED'
      OR a.organization_id IS DISTINCT FROM p_organization_id OR a.checksum IS DISTINCT FROM p_video_sha256
      OR a.artifact_id IS DISTINCT FROM j.artifact_id OR a.material_component_id IS DISTINCT FROM j.material_component_id
      OR a.provider IS DISTINCT FROM 'hyperframes' OR a.mime_type IS DISTINCT FROM 'video/mp4'
      OR a.file_size_bytes IS DISTINCT FROM p_size_bytes OR a.storage_bucket IS DISTINCT FROM 'production-videos'
      OR a.storage_path IS DISTINCT FROM 'production-videos/' || object_path
      OR a.public_url IS DISTINCT FROM p_public_url
      OR a.metadata->>'render_execution_id' IS DISTINCT FROM e.id::text
      OR a.metadata->>'render_request_id' IS DISTINCT FROM r.id::text
      OR a.metadata->>'composition_revision_id' IS DISTINCT FROM v.id::text
      OR a.metadata->>'render_backend' IS DISTINCT FROM 'CONTROLLED'
      OR a.metadata->>'integrity_method' IS DISTINCT FROM 'storage-stream-sha256-v1'
      OR a.metadata->>'supervisor_receipt_sha256' IS DISTINCT FROM e.receipt_sha256
      OR j.output_snapshot#>>'{final_video,asset_id}' IS DISTINCT FROM a.id::text THEN
      RAISE EXCEPTION 'CONTROLLED_RENDER_FINALIZATION_CONFLICT';
    END IF;
    RETURN a.id;
  END IF;
  IF j.status = 'SUCCEEDED' OR r.import_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_FINALIZATION_CONFLICT';
  END IF;
  -- Duration comes from the frozen contract, not untrusted upload metadata.
  duration := GREATEST(1, round((e.contract#>>'{canvas,durationSeconds}')::numeric)::integer);
  INSERT INTO public.production_assets (artifact_id,asset_type,created_by,duration_seconds,file_size_bytes,
    material_component_id,metadata,mime_type,organization_id,production_job_id,provider,public_url,
    qa_status,storage_bucket,storage_path,checksum)
  VALUES (j.artifact_id,'FINAL_VIDEO',j.created_by,duration,p_size_bytes,j.material_component_id,
    jsonb_build_object('render_request_id',r.id,'render_execution_id',e.id,'composition_revision_id',v.id,
      'supervisor_receipt_sha256',e.receipt_sha256,'render_backend','CONTROLLED',
      'integrity_method','storage-stream-sha256-v1','imported_at',now()),
    'video/mp4',p_organization_id,j.id,'hyperframes',p_public_url,'READY_FOR_QA',
    'production-videos','production-videos/' || object_path,p_video_sha256) RETURNING * INTO a;
  UPDATE public.material_components SET assets =
    (coalesce(assets,'{}'::jsonb) - 'final_video_assembly_stale' - 'final_video_layout_stale')
    || jsonb_build_object('final_video_asset_provider','hyperframes','final_video_source','hyperframes_controlled',
      'final_video_storage_path',a.storage_path,'final_video_url',p_public_url,
      'production_status','COMPLETED','video_duration',duration,'updated_at',now())
    WHERE id = j.material_component_id;
  UPDATE public.production_jobs SET status = 'SUCCEEDED',completed_at = now(),failed_at = NULL,
    provider_error = NULL, updated_at = now(), progress = private.append_production_progress(progress,100,'completed'),
    output_snapshot = coalesce(output_snapshot,'{}'::jsonb) || jsonb_build_object('render_backend','CONTROLLED',
      'render_execution_id',e.id,'supervisor_receipt_sha256',e.receipt_sha256,
      'final_video',jsonb_build_object('asset_id',a.id,'file_size_bytes',p_size_bytes,
        'public_url',p_public_url,'storage_path',a.storage_path,'checksum',p_video_sha256)) WHERE id = j.id;
  UPDATE public.hyperframes_render_requests SET provider_status = 'COMPLETED',import_status = 'COMPLETED',
    provider_error = NULL,updated_at = now() WHERE id = r.id;
  RETURN a.id;
END $$;
REVOKE ALL ON FUNCTION public.finalize_controlled_composition_render(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_controlled_composition_render(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text) TO service_role;
-- Rollback: stop controlled finalizer, revoke this RPC; preserve imported assets and consumed evidence.
COMMIT;
