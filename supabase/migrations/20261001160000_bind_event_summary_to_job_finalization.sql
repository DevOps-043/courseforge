-- Prepared only. Bind aggregate diagnostics to immutable packets in the same transaction as lease/CAS closure.
CREATE FUNCTION private.verify_hyperframes_event_summary(
  p_organization_id uuid, p_revision_id uuid, p_video_sha256 text, p_summary jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_revision public.video_composition_revisions%ROWTYPE; v_authorization jsonb;
  v_root_batch jsonb; v_batch_count integer; v_checkpoint_count integer; v_total_measured integer := 0;
  v_batch jsonb; v_index integer := 0; v_identity jsonb; v_packet private.hyperframes_event_batch_measurements%ROWTYPE;
  v_visual private.hyperframes_event_visual_conformance_evidence%ROWTYPE; v_measured integer; v_expected integer;
  v_status text := 'PASS';
BEGIN
  -- Up to 750 bounded per-partition metric summaries; the enclosing report remains <= 1 MiB.
  IF jsonb_typeof(p_summary) IS DISTINCT FROM 'object' OR octet_length(p_summary::text) > 786432
    OR p_summary->>'schemaVersion' IS DISTINCT FROM '1'
    OR p_summary->>'scope' IS DISTINCT FROM 'COMPLETE_NATIVE_EVENT_VISUAL_SAMPLE_COVERAGE_NOT_FULL_RENDER_ATTESTATION'
    OR p_summary->>'organizationId' IS DISTINCT FROM p_organization_id::text
    OR p_summary->>'revisionId' IS DISTINCT FROM p_revision_id::text
    OR p_video_sha256 IS NULL OR p_video_sha256 !~ '^[a-f0-9]{64}$'
    OR p_summary->>'videoSha256' IS DISTINCT FROM p_video_sha256
    OR jsonb_typeof(p_summary->'batches') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT * INTO v_revision FROM public.video_composition_revisions
    WHERE id = p_revision_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_authorization := v_revision.manifest->'conformance_event_batch_authorization';
  v_root_batch := v_authorization->'rootBatch';
  IF v_authorization->>'policy' IS DISTINCT FROM 'FROZEN_EVENT_PARTITION_CONTRACT_HASHES_V1'
    OR v_revision.manifest->>'conformance_reference_version' IS DISTINCT FROM '1'
    OR p_summary->>'projectHash' IS DISTINCT FROM v_revision.project_hash
    OR p_summary->>'documentHash' IS DISTINCT FROM v_revision.manifest->>'draft_document_hash'
    OR p_summary->>'documentHash' IS DISTINCT FROM v_authorization->>'documentHash'
    OR p_summary->>'parentContractSha256' IS DISTINCT FROM v_authorization->>'parentContractSha256'
    OR jsonb_typeof(v_authorization->'batchContractSha256') IS DISTINCT FROM 'array'
    OR v_authorization->>'parentContractSha256' IS DISTINCT FROM v_authorization->'batchContractSha256'->>0
    OR p_summary->>'planSha256' IS DISTINCT FROM v_root_batch->>'planSha256'
    OR v_root_batch IS DISTINCT FROM v_revision.manifest#>'{conformance_contract,checkpointBatch}'
    OR v_root_batch->>'batchIndex' IS DISTINCT FROM '0' THEN RETURN false; END IF;
  v_batch_count := (v_root_batch->>'batchCount')::integer;
  v_checkpoint_count := (v_root_batch->>'totalCheckpointCount')::integer;
  IF v_batch_count IS NULL OR v_checkpoint_count IS NULL
    OR v_batch_count NOT BETWEEN 1 AND 750 OR v_checkpoint_count NOT BETWEEN 1 AND 36000
    OR v_batch_count <> (v_checkpoint_count + 47) / 48
    OR (p_summary->>'requiredBatchCount')::integer IS DISTINCT FROM v_batch_count
    OR (p_summary->>'requiredCheckpointCount')::integer IS DISTINCT FROM v_checkpoint_count
    OR (p_summary->>'measuredBatchCount')::integer IS DISTINCT FROM v_batch_count
    OR jsonb_array_length(p_summary->'batches') <> v_batch_count
    OR p_summary->>'resumedBatchCount' IS NULL OR (p_summary->>'resumedBatchCount')::integer NOT BETWEEN 0 AND v_batch_count
    OR jsonb_array_length(v_authorization->'batchContractSha256') <> v_batch_count THEN RETURN false; END IF;
  FOR v_batch IN SELECT value FROM jsonb_array_elements(p_summary->'batches') LOOP
    IF (v_batch->>'batchIndex')::integer IS DISTINCT FROM v_index
      OR v_batch->>'status' IS NULL OR v_batch->>'status' NOT IN ('PASS','FAIL','INCOMPLETE') THEN RETURN false; END IF;
    v_identity := jsonb_build_object('organizationId', p_organization_id, 'revisionId', p_revision_id,
      'projectHash', v_revision.project_hash, 'videoSha256', p_video_sha256, 'documentHash', p_summary->>'documentHash',
      'parentContractSha256', p_summary->>'parentContractSha256',
      'batchContractSha256', v_authorization->'batchContractSha256'->>v_index,
      'batch', jsonb_set(v_root_batch, '{batchIndex}', to_jsonb(v_index)));
    -- Exact identity lookup uses the packet primary key, not an unindexed JSON scan.
    SELECT * INTO v_packet FROM private.hyperframes_event_batch_measurements WHERE identity = v_identity FOR SHARE;
    IF NOT FOUND OR v_packet.packet_sha256 IS DISTINCT FROM v_batch->>'packetSha256'
      OR v_packet.organization_id IS DISTINCT FROM p_organization_id OR v_packet.revision_id IS DISTINCT FROM p_revision_id
      OR v_packet.batch_index IS DISTINCT FROM v_index THEN RETURN false; END IF;
    SELECT * INTO v_visual FROM private.hyperframes_event_visual_conformance_evidence
      WHERE revision_id = p_revision_id AND organization_id = p_organization_id
        AND batch_index = v_index AND bundle_sha256 = v_packet.visual_sha256 FOR SHARE;
    IF NOT FOUND OR v_visual.project_hash IS DISTINCT FROM v_revision.project_hash
      OR v_visual.document_hash IS DISTINCT FROM p_summary->>'documentHash'
      OR v_visual.lineage->'batch' IS DISTINCT FROM v_identity->'batch'
      OR v_visual.lineage->>'parentContractSha256' IS DISTINCT FROM p_summary->>'parentContractSha256'
      OR v_visual.lineage->>'batchContractSha256' IS DISTINCT FROM v_identity->>'batchContractSha256' THEN RETURN false; END IF;
    SELECT count(DISTINCT sample->>'frameIndex') INTO v_measured FROM jsonb_array_elements(v_packet.packet->'samples') sample
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_visual.contract->'checkpoints') checkpoint
        WHERE checkpoint->>'frameIndex' = sample->>'frameIndex');
    v_expected := LEAST(48, v_checkpoint_count - v_index * 48);
    IF (v_batch->>'measuredCheckpointCount')::integer IS DISTINCT FROM v_measured
      OR v_measured > v_expected OR (v_batch->>'status' = 'PASS' AND v_measured <> v_expected) THEN RETURN false; END IF;
    v_total_measured := v_total_measured + v_measured;
    IF v_batch->>'status' = 'FAIL' THEN v_status := 'FAIL';
    ELSIF v_status <> 'FAIL' AND v_batch->>'status' = 'INCOMPLETE' THEN v_status := 'INCOMPLETE'; END IF;
    v_index := v_index + 1;
  END LOOP;
  IF v_status <> 'FAIL' AND v_total_measured <> v_checkpoint_count THEN v_status := 'INCOMPLETE'; END IF;
  RETURN (p_summary->>'measuredCheckpointCount')::integer IS NOT DISTINCT FROM v_total_measured
    AND p_summary->>'status' IS NOT DISTINCT FROM v_status;
END;
$$;
REVOKE ALL ON FUNCTION private.verify_hyperframes_event_summary(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Pure, fail-closed deck contract check. This can be exercised without render/job fixtures.
CREATE FUNCTION private.verify_hyperframes_deck_summary(p_contract jsonb, p_document_hash text, p_report jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, private AS $$
DECLARE v_plan jsonb := p_contract->'deckTextPlan'; v_expected_regions integer;
BEGIN
  IF v_plan IS NULL THEN RETURN p_report#>'{comparison,visual,deckText}' IS NULL; END IF;
  IF jsonb_typeof(v_plan) IS DISTINCT FROM 'object'
    OR v_plan->>'policy' IS DISTINCT FROM 'SOURCE_HTML_TEXT_NODE_PATHS_V1'
    OR v_plan->>'documentHash' IS DISTINCT FROM p_document_hash
    OR jsonb_typeof(v_plan->'clips') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_contract->'checkpoints') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT coalesce(sum(jsonb_array_length(clip->'entries')), 0)::integer INTO v_expected_regions
    FROM jsonb_array_elements(p_contract->'checkpoints') checkpoint
    CROSS JOIN jsonb_array_elements(v_plan->'clips') clip
    WHERE (clip#>>'{window,excluded}')::boolean = false
      AND (checkpoint->>'timeSeconds')::numeric >= (clip#>>'{window,startSeconds}')::numeric
      AND (checkpoint->>'timeSeconds')::numeric < (clip#>>'{window,endSeconds}')::numeric;
  IF p_report#>>'{comparison,visual,deckText,policy}' IS DISTINCT FROM 'SOURCE_HTML_TEXT_NODE_PATHS_V1'
    OR p_report#>>'{comparison,visual,deckText,scope}' IS DISTINCT FROM 'DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION'
    OR p_report#>>'{comparison,visual,deckText,status}' IS NULL
    OR p_report#>>'{comparison,visual,deckText,status}' NOT IN ('PASS','FAIL','INCOMPLETE')
    OR (p_report#>>'{comparison,visual,deckText,requiredCheckpointCount}')::integer IS DISTINCT FROM jsonb_array_length(p_contract->'checkpoints')
    OR (p_report#>>'{comparison,visual,deckText,expectedRegionCount}')::integer IS DISTINCT FROM v_expected_regions
    OR (p_report#>>'{comparison,visual,deckText,checkedCheckpointCount}')::integer IS NULL
    OR (p_report#>>'{comparison,visual,deckText,checkedCheckpointCount}')::integer NOT BETWEEN 0 AND jsonb_array_length(p_contract->'checkpoints')
    OR (p_report#>>'{comparison,visual,deckText,checkedRegionCount}')::integer IS NULL
    OR (p_report#>>'{comparison,visual,deckText,checkedRegionCount}')::integer < 0 THEN RETURN false; END IF;
  -- Source text regions cannot attest renderer font use or all deck paint.
  IF jsonb_array_length(v_plan->'clips') > 0 AND (p_report->>'status' = 'PASS'
    OR p_report#>>'{comparison,visual,status}' = 'PASS'
    OR NOT coalesce((p_report#>'{comparison,visual,incompletenessReasons}') ? 'DECK_TEXT_EVIDENCE_INCOMPLETE', false))
    THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private.verify_hyperframes_deck_summary(jsonb, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve every original audio/integrity/lease/CAS gate; callers cannot bypass the wrapper.
ALTER FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) RENAME TO finish_hyperframes_conformance_job_before_events;
ALTER FUNCTION public.finish_hyperframes_conformance_job_before_events(uuid, uuid, jsonb, text, boolean) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.finish_hyperframes_conformance_job_before_events(uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.finish_hyperframes_conformance_job(
  p_job_id uuid, p_lease_token uuid, p_report jsonb DEFAULT NULL, p_error_code text DEFAULT NULL, p_retryable boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_job private.hyperframes_conformance_jobs%ROWTYPE; v_revision public.video_composition_revisions%ROWTYPE;
  v_event_contract boolean;
BEGIN
  SELECT * INTO v_job FROM private.hyperframes_conformance_jobs
    WHERE id = p_job_id AND lease_token = p_lease_token AND status = 'RUNNING' AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_report IS NOT NULL THEN
    SELECT * INTO v_revision FROM public.video_composition_revisions
      WHERE id = v_job.revision_id AND organization_id = v_job.organization_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONFORMANCE_JOB_REVISION_MISSING'; END IF;
    IF v_revision.manifest#>>'{conformance_contract,schemaVersion}' = '4'
      AND NOT private.verify_hyperframes_deck_summary(v_revision.manifest->'conformance_contract',
        v_revision.manifest->>'draft_document_hash', p_report) THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_DECK_TEXT_CONTRACT_INVALID';
    END IF;
    -- Encoded Rec.709 declarations do not establish pixel conversion. Preserve INCOMPLETE until attested.
    IF v_revision.manifest#>>'{conformance_contract,colorTagPolicy}' = 'sdr-rec709-tags-v1'
      AND (p_report->>'status' = 'PASS' OR p_report#>>'{comparison,visual,status}' = 'PASS'
        OR NOT coalesce((p_report#>'{comparison,visual,incompletenessReasons}') ? 'SDR_PIXEL_CONVERSION_UNATTESTED', false)) THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_SDR_CONVERSION_UNATTESTED';
    END IF;
    v_event_contract := v_revision.manifest#>'{conformance_contract,checkpointBatch}' IS NOT NULL;
    IF v_event_contract THEN
      IF NOT private.verify_hyperframes_event_summary(v_job.organization_id, v_job.revision_id,
        p_report#>>'{integrity,checksum}', p_report->'eventCheckpointExecution') THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_EVENT_PACKET_LINKAGE_INVALID';
      END IF;
      -- Complete sample coverage is not yet the audited global renderer gate.
      IF p_report->>'status' = 'PASS' AND (v_revision.manifest#>>'{conformance_contract,checkpointBatch,batchCount}')::integer > 1 THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_EVENT_GLOBAL_GATE_PENDING';
      END IF;
    ELSIF p_report ? 'eventCheckpointExecution' THEN RAISE EXCEPTION 'CONFORMANCE_JOB_EVENT_UNEXPECTED'; END IF;
  END IF;
  RETURN private.finish_hyperframes_conformance_job_before_events(p_job_id, p_lease_token, p_report, p_error_code, p_retryable);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) TO service_role;

-- Rollback: stop workers; drop the new public wrapper; move the private legacy finisher back to
-- public and restore its original name/service-role grant; drop the private verifier. No data deletion.
