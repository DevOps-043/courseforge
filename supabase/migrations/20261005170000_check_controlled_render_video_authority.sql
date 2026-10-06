-- PREPARED ONLY: read-only downstream gate; never grants conformance or renews execution authority.
BEGIN;
CREATE FUNCTION public.check_controlled_render_video_authority(p_organization_id uuid,p_request_id uuid,
  p_execution_id uuid,p_revision_id uuid,p_production_job_id uuid,p_asset_id uuid,
  p_receipt_sha256 text,p_video_sha256 text,p_size_bytes bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.composition_render_executions e
    JOIN private.composition_render_supervisor_keys k ON k.organization_id = e.organization_id
      AND k.supervisor_id = e.supervisor_id AND k.key_id = e.key_id AND NOT k.revoked
    JOIN public.hyperframes_render_requests r ON r.id = e.request_id AND r.organization_id = e.organization_id
    JOIN public.production_jobs j ON j.id = e.production_job_id AND j.organization_id = e.organization_id
    JOIN public.video_composition_revisions v ON v.id = e.revision_id AND v.organization_id = e.organization_id
    JOIN public.production_assets a ON a.id = p_asset_id AND a.organization_id = e.organization_id
    WHERE e.id = p_execution_id AND e.organization_id = p_organization_id AND e.request_id = p_request_id
      AND e.revision_id = p_revision_id AND e.production_job_id = p_production_job_id
      AND e.status = 'CONSUMED' AND e.receipt_sha256 = p_receipt_sha256
      AND e.consumed_at_ms >= e.issued_at_ms AND e.consumed_at_ms < e.expires_at_ms
      AND e.receipt#>>'{payload,binding,videoSha256}' = p_video_sha256
      AND e.receipt#>>'{payload,binding,sizeBytes}' = p_size_bytes::text
      AND p_size_bytes BETWEEN 1 AND 2147483648
      AND p_video_sha256 ~ '^[a-f0-9]{64}$' AND p_receipt_sha256 ~ '^[a-f0-9]{64}$'
      AND r.production_job_id = j.id AND r.composition_revision_id = v.id
      AND r.provider_render_id IS NULL AND r.cancelled_at IS NULL
      AND r.provider_status = 'COMPLETED' AND r.import_status = 'COMPLETED'
      AND j.status = 'SUCCEEDED' AND j.input_snapshot->>'render_backend' = 'CONTROLLED'
      AND j.input_snapshot->>'revision_id' = v.id::text AND j.input_snapshot->>'project_hash' = v.project_hash
      AND v.project_hash = e.project_hash AND v.manifest->'conformance_contract' = e.contract
      AND v.manifest->>'draft_document_hash' = e.document_hash
      AND j.output_snapshot->>'render_backend' = 'CONTROLLED'
      AND j.output_snapshot->>'render_execution_id' = e.id::text
      AND j.output_snapshot->>'supervisor_receipt_sha256' = e.receipt_sha256
      AND j.output_snapshot#>>'{final_video,asset_id}' = a.id::text
      AND j.output_snapshot#>>'{final_video,checksum}' = p_video_sha256
      AND a.production_job_id = j.id AND a.artifact_id = j.artifact_id
      AND a.material_component_id = j.material_component_id AND a.asset_type = 'FINAL_VIDEO'
      AND a.provider = 'hyperframes' AND a.mime_type = 'video/mp4'
      AND a.metadata->>'render_backend' = 'CONTROLLED'
      AND a.metadata->>'render_execution_id' = e.id::text
      AND a.metadata->>'render_request_id' = r.id::text
      AND a.metadata->>'composition_revision_id' = v.id::text
      AND a.metadata->>'supervisor_receipt_sha256' = e.receipt_sha256
      AND a.metadata->>'integrity_method' = 'storage-stream-sha256-v1'
      AND a.metadata->>'provider_render_id' IS NULL
      AND a.checksum = p_video_sha256 AND a.file_size_bytes = p_size_bytes
      AND a.storage_bucket = 'production-videos'
      AND a.storage_path = 'production-videos/organizations/' || e.organization_id::text
        || '/controlled-renders/' || r.id::text || '/' || e.id::text || '/' || p_video_sha256 || '.mp4'
  );
$$;
REVOKE ALL ON FUNCTION public.check_controlled_render_video_authority(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_controlled_render_video_authority(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint) TO service_role;

-- Preserve the existing lease/result/retry machinery, but close the gap between Node's final read and durable finish.
ALTER FUNCTION public.finish_hyperframes_video_integrity_job(uuid,uuid,jsonb,text,boolean)
  RENAME TO finish_hyperframes_video_integrity_job_without_controlled_gate;
ALTER FUNCTION public.finish_hyperframes_video_integrity_job_without_controlled_gate(uuid,uuid,jsonb,text,boolean) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.finish_hyperframes_video_integrity_job_without_controlled_gate(uuid,uuid,jsonb,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.finish_hyperframes_video_integrity_job(p_job_id uuid,p_lease_token uuid,p_result jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,p_retryable boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE q private.hyperframes_video_integrity_jobs%ROWTYPE; r public.hyperframes_render_requests%ROWTYPE;
  j public.production_jobs%ROWTYPE; a public.production_assets%ROWTYPE; execution_id uuid;
BEGIN
  -- No write here: the preserved implementation remains the sole lease CAS/finish authority.
  SELECT * INTO q FROM private.hyperframes_video_integrity_jobs WHERE id = p_job_id
    AND status = 'RUNNING' AND lease_token = p_lease_token AND lease_expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_error_code IS NULL THEN
    SELECT * INTO r FROM public.hyperframes_render_requests
      WHERE id = q.request_id AND organization_id = q.organization_id FOR SHARE;
    SELECT * INTO j FROM public.production_jobs WHERE id = r.production_job_id
      AND organization_id = q.organization_id FOR SHARE;
    SELECT * INTO a FROM public.production_assets WHERE production_job_id = j.id
      AND organization_id = q.organization_id AND asset_type = 'FINAL_VIDEO' FOR SHARE;
    IF j.input_snapshot->>'render_backend' = 'CONTROLLED' OR a.metadata->>'render_backend' = 'CONTROLLED' THEN
      execution_id := (a.metadata->>'render_execution_id')::uuid;
      -- Hold current revocation through finish; expired keys are allowed only for previously consumed evidence.
      PERFORM 1 FROM private.composition_render_executions e
        JOIN private.composition_render_supervisor_keys k ON k.organization_id = e.organization_id
          AND k.supervisor_id = e.supervisor_id AND k.key_id = e.key_id
        WHERE e.id = execution_id AND e.organization_id = q.organization_id AND NOT k.revoked FOR SHARE OF e,k;
      IF NOT FOUND OR NOT public.check_controlled_render_video_authority(q.organization_id,r.id,execution_id,
        r.composition_revision_id,j.id,a.id,a.metadata->>'supervisor_receipt_sha256',
        p_result->>'checksum',(p_result->>'sizeBytes')::bigint) THEN
        RAISE EXCEPTION 'VIDEO_INTEGRITY_AUTHORITY_REJECTED';
      END IF;
    END IF;
  END IF;
  RETURN private.finish_hyperframes_video_integrity_job_without_controlled_gate(
    p_job_id,p_lease_token,p_result,p_error_code,p_retryable);
END $$;
REVOKE ALL ON FUNCTION public.finish_hyperframes_video_integrity_job(uuid,uuid,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_video_integrity_job(uuid,uuid,jsonb,text,boolean) TO service_role;
-- Rollback: stop CONTROLLED downstream consumers, revoke gate, preserve authority/assets/evidence.
COMMIT;
