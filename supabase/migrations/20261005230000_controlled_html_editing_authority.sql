-- PREPARED ONLY. Requires worker fences and HTML exact-reader migrations.
-- No worker, template, flag, trigger or migration application is enabled here.
BEGIN;
CREATE FUNCTION public.read_controlled_render_html_editing_authority(p_organization_id uuid,p_request_id uuid,
  p_revision_id uuid,p_production_job_id uuid,p_worker_lease_token uuid,p_document_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE r public.hyperframes_render_requests%ROWTYPE; j public.production_jobs%ROWTYPE;
  v public.video_composition_revisions%ROWTYPE; e private.composition_render_executions%ROWTYPE;
  q private.controlled_render_worker_jobs%ROWTYPE;
  resolved_draft_id uuid; compilation jsonb; result jsonb; image_assets jsonb := '[]'::jsonb; image_record record;
BEGIN
  IF p_worker_lease_token IS NULL OR p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH';
  END IF;
  -- Request-first lock order matches issue/admit/queue/finalization. The lease
  -- helper alone supports legacy requests, so explicitly require queue enrollment.
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  SELECT * INTO q FROM private.controlled_render_worker_jobs WHERE request_id = p_request_id
    AND organization_id = p_organization_id AND status = 'RUNNING' AND lease_token = p_worker_lease_token FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH'; END IF;
  SELECT * INTO r FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id;
  IF NOT FOUND OR r.production_job_id IS DISTINCT FROM p_production_job_id
    OR r.composition_revision_id IS DISTINCT FROM p_revision_id OR r.cancelled_at IS NOT NULL
    OR r.provider_render_id IS NOT NULL OR r.provider_status IS NULL OR r.provider_status NOT IN ('PENDING','RUNNING') THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH';
  END IF;
  SELECT * INTO j FROM public.production_jobs WHERE id = p_production_job_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND OR j.created_by IS NULL OR j.status IS NULL OR j.status NOT IN ('PENDING','QUEUED','RUNNING') THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH';
  END IF;
  SELECT * INTO v FROM public.video_composition_revisions WHERE id = p_revision_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND OR j.input_snapshot->>'render_backend' IS DISTINCT FROM 'CONTROLLED'
    OR j.input_snapshot->>'revision_id' IS DISTINCT FROM v.id::text
    OR j.input_snapshot->>'project_hash' IS DISTINCT FROM v.project_hash
    OR v.manifest->>'draft_document_hash' IS DISTINCT FROM p_document_hash
    OR v.manifest#>>'{conformance_contract,documentHash}' IS DISTINCT FROM p_document_hash
    OR v.manifest#>>'{conformance_contract,schemaVersion}' IS DISTINCT FROM '4'
    OR v.manifest#>>'{conformance_contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR v.manifest->>'draft_document_id' IS NULL
    OR v.manifest->>'draft_document_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH';
  END IF;
  SELECT * INTO e FROM private.composition_render_executions WHERE request_id = p_request_id
    AND organization_id = p_organization_id AND status = 'RUNNING' FOR SHARE;
  IF NOT FOUND OR e.revision_id IS DISTINCT FROM v.id OR e.production_job_id IS DISTINCT FROM j.id
    OR e.issuance_id IS DISTINCT FROM q.issuance_id OR e.supervisor_id IS DISTINCT FROM q.supervisor_id
    OR e.key_id IS DISTINCT FROM q.key_id
    OR e.document_hash IS DISTINCT FROM p_document_hash OR e.project_hash IS DISTINCT FROM v.project_hash
    OR e.contract IS DISTINCT FROM v.manifest->'conformance_contract'
    OR e.expires_at_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH';
  END IF;
  PERFORM 1 FROM private.composition_render_supervisor_keys WHERE organization_id = e.organization_id
    AND supervisor_id = e.supervisor_id AND key_id = e.key_id AND NOT revoked
    AND not_before_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
    AND not_after_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH'; END IF;
  resolved_draft_id := (v.manifest->>'draft_document_id')::uuid;
  PERFORM 1 FROM public.video_composition_drafts WHERE id = resolved_draft_id AND organization_id = p_organization_id
    AND composition_id = v.composition_id AND state = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH'; END IF;
  -- Actor is stored job creator, never archive/request input or revision creator.
  -- Delegated reader rechecks active tenant role, templates, grants and exact
  -- historical native/HTML pointers under the same transaction's locks.
  compilation := public.read_html_editing_compilation(p_organization_id,resolved_draft_id,j.created_by,p_document_hash);
  -- Exact reader holds link/asset locks. Return independently stored identities,
  -- not merely UUID grants: a replaced asset must not authorize frozen bytes.
  FOR image_record IN SELECT a.id,a.checksum,a.file_size_bytes,a.mime_type,a.storage_bucket,a.storage_path
    FROM public.video_composition_draft_assets l JOIN public.production_assets a ON a.id = l.production_asset_id
    WHERE l.draft_id = resolved_draft_id AND l.organization_id = p_organization_id AND a.organization_id = p_organization_id
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(compilation->'revisions') entry,
        jsonb_array_elements_text(entry->'grantedAssetIds') granted(id) WHERE granted.id = a.id::text)
    ORDER BY a.id FOR SHARE OF l,a
  LOOP
    image_assets := image_assets || jsonb_build_array(jsonb_build_object('productionAssetId',image_record.id,
      'checksum',image_record.checksum,'fileSizeBytes',image_record.file_size_bytes,'mimeType',image_record.mime_type,
      'storageBucket',image_record.storage_bucket,'storagePath',image_record.storage_path));
    IF octet_length(image_assets::text) > 16777216 THEN RAISE EXCEPTION 'HTML_EDITING_PAYLOAD_LIMIT'; END IF;
  END LOOP;
  result := jsonb_build_object('documentId',resolved_draft_id,'compilation',compilation,'imageAssets',image_assets);
  IF octet_length(result::text) > 16777216 THEN RAISE EXCEPTION 'HTML_EDITING_PAYLOAD_LIMIT'; END IF;
  PERFORM private.assert_controlled_render_worker_lease(p_organization_id,p_request_id,p_worker_lease_token);
  IF e.expires_at_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint THEN
    RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH';
  END IF;
  PERFORM 1 FROM private.composition_render_supervisor_keys WHERE organization_id = e.organization_id
    AND supervisor_id = e.supervisor_id AND key_id = e.key_id AND NOT revoked
    AND not_before_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
    AND not_after_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_controlled_render_html_editing_authority(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_controlled_render_html_editing_authority(uuid,uuid,uuid,uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.read_controlled_render_html_editing_authority(uuid,uuid,uuid,uuid,uuid,text) IS
  'Prepared claim/lease-bound exact HTML reader using current stored job actor and revision draft lineage. No rollout or isolation proof.';
COMMIT;
