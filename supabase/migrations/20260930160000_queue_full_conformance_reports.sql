-- Prepared only: no backfill, no QA approval and no publication state changes.
CREATE TABLE private.hyperframes_conformance_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES public.hyperframes_render_requests(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid, lease_expires_at timestamptz, attempt_started_at timestamptz,
  report jsonb,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^CONFORMANCE_JOB_[A-Z_]+$'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND attempt_started_at IS NOT NULL)
    OR (status <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK (report IS NULL OR (jsonb_typeof(report) = 'object' AND octet_length(report::text) <= 1048576)),
  CHECK (status <> 'SUCCEEDED' OR report IS NOT NULL)
);
ALTER TABLE private.hyperframes_conformance_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_conformance_jobs FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX hyperframes_conformance_pending_idx ON private.hyperframes_conformance_jobs(next_attempt_at,created_at) WHERE status = 'PENDING';
CREATE INDEX hyperframes_conformance_expired_idx ON private.hyperframes_conformance_jobs(lease_expires_at) WHERE status = 'RUNNING';

CREATE FUNCTION private.enqueue_hyperframes_full_conformance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  IF NEW.status = 'SUCCEEDED' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO private.hyperframes_conformance_jobs(organization_id,request_id,revision_id)
    SELECT NEW.organization_id, r.id, v.id
    FROM public.hyperframes_render_requests r
    JOIN public.video_composition_revisions v ON v.id = r.composition_revision_id AND v.organization_id = r.organization_id
    WHERE r.id = NEW.request_id AND r.organization_id = NEW.organization_id
      AND r.provider_status = 'COMPLETED' AND r.import_status = 'COMPLETED'
      AND v.manifest->>'conformance_reference_version' = '1'
      AND v.manifest->>'draft_document_hash' = NEW.result->>'documentHash'
      AND v.manifest #>> '{conformance_contract,documentHash}' = NEW.result->>'documentHash'
    ON CONFLICT(request_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enqueue_hyperframes_full_conformance() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enqueue_full_conformance_after_integrity
AFTER UPDATE OF status ON private.hyperframes_video_integrity_jobs
FOR EACH ROW EXECUTE FUNCTION private.enqueue_hyperframes_full_conformance();

CREATE FUNCTION public.claim_hyperframes_conformance_job()
RETURNS TABLE(id uuid,organization_id uuid,request_id uuid,revision_id uuid,lease_token uuid,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE selected_id uuid;
BEGIN
  UPDATE private.hyperframes_conformance_jobs j SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
    error_code = 'CONFORMANCE_JOB_LEASE_EXHAUSTED', updated_at = now()
    WHERE j.status = 'RUNNING' AND j.lease_expires_at <= now() AND j.attempts >= 5;
  SELECT j.id INTO selected_id FROM private.hyperframes_conformance_jobs j
    WHERE j.attempts < 5 AND ((j.status = 'PENDING' AND j.next_attempt_at <= now())
      OR (j.status = 'RUNNING' AND j.lease_expires_at <= now()))
    ORDER BY j.next_attempt_at,j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF selected_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE private.hyperframes_conformance_jobs j
    SET status = 'RUNNING', attempts = j.attempts + 1, lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '30 minutes', attempt_started_at = now(), error_code = NULL, updated_at = now()
    WHERE j.id = selected_id RETURNING j.id,j.organization_id,j.request_id,j.revision_id,j.lease_token,j.attempts;
END $$;

CREATE FUNCTION public.renew_hyperframes_conformance_job(p_job_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  UPDATE private.hyperframes_conformance_jobs SET lease_expires_at = least(now() + interval '30 minutes',attempt_started_at + interval '2 hours'), updated_at = now()
  WHERE id = p_job_id AND lease_token = p_lease_token AND status = 'RUNNING'
    AND lease_expires_at > now() AND attempt_started_at + interval '2 hours' > now();
  RETURN FOUND;
END $$;

CREATE FUNCTION public.finish_hyperframes_conformance_job(
  p_job_id uuid,p_lease_token uuid,p_report jsonb DEFAULT NULL,p_error_code text DEFAULT NULL,p_retryable boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE job private.hyperframes_conformance_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM private.hyperframes_conformance_jobs j WHERE j.id = p_job_id
    AND j.status = 'RUNNING' AND j.lease_token = p_lease_token AND j.lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_report IS NOT NULL THEN
    IF p_error_code IS NOT NULL OR jsonb_typeof(p_report) <> 'object' OR octet_length(p_report::text) > 1048576
      OR (p_report->>'reportVersion') IS DISTINCT FROM '1'
      OR (p_report->>'scope') IS DISTINCT FROM 'REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE'
      OR (p_report->>'status') IS NULL OR p_report->>'status' NOT IN ('PASS','FAIL','INCOMPLETE')
      OR (p_report->>'organizationId') IS DISTINCT FROM job.organization_id::text
      OR (p_report->>'requestId') IS DISTINCT FROM job.request_id::text
      OR (p_report->>'revisionId') IS DISTINCT FROM job.revision_id::text
      OR (p_report #>> '{comparison,reportVersion}') IS DISTINCT FROM '2'
      OR (p_report #>> '{comparison,status}') IS DISTINCT FROM (p_report->>'status')
      OR (p_report #>> '{comparison,audioTiming,status}') IS NULL
      OR (p_report #>> '{comparison,audioTiming,method}') IS DISTINCT FROM 'STEREO_ENERGY_ENVELOPE_STREAM_V3'
      OR (p_report #>> '{comparison,audioTiming,policy,id}') IS DISTINCT FROM 'stereo-envelope-v3'
      OR (p_report #>> '{comparison,audioTiming,rms,policy,id}') IS DISTINCT FROM 'stereo-rms-window-v1'
      OR (p_report #>> '{comparison,audioTiming,rms,status}') IS NULL
      OR (p_report #>> '{comparison,audioTiming,rms,status}') NOT IN ('NOT_REQUESTED','PASS','FAIL','INCOMPLETE')
      OR (p_report->>'status' = 'PASS' AND (p_report #>> '{comparison,audioTiming,status}') IS DISTINCT FROM 'PASS')
      OR (p_report->>'status' = 'PASS' AND (p_report #>> '{comparison,audioTiming,rms,status}') IS DISTINCT FROM 'PASS')
      OR (p_report #>> '{comparison,audioTiming,status}') NOT IN ('PASS','FAIL','INCOMPLETE','MEASUREMENT_FAILED') THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_REPORT_INVALID';
    END IF;
    -- Exact request, current asset, frozen revision and immutable visual/audio pair.
    IF NOT EXISTS (
      SELECT 1 FROM public.hyperframes_render_requests r
      JOIN public.production_jobs j ON j.id = r.production_job_id AND j.organization_id = r.organization_id
      JOIN public.production_assets a ON a.production_job_id = j.id AND a.organization_id = j.organization_id
      JOIN public.video_composition_revisions v ON v.id = r.composition_revision_id AND v.organization_id = r.organization_id
      JOIN private.hyperframes_video_integrity_jobs i ON i.request_id = r.id AND i.organization_id = r.organization_id AND i.status = 'SUCCEEDED'
      JOIN private.hyperframes_visual_conformance_evidence visual ON visual.revision_id = v.id AND visual.organization_id = v.organization_id
      JOIN private.hyperframes_audio_conformance_evidence audio ON audio.revision_id = v.id AND audio.organization_id = v.organization_id AND audio.visual_checksum = visual.bundle_sha256
      WHERE r.id = job.request_id AND r.organization_id = job.organization_id AND v.id = job.revision_id
        AND r.provider_status = 'COMPLETED' AND r.import_status = 'COMPLETED' AND j.status = 'SUCCEEDED'
        AND a.provider = 'hyperframes' AND a.asset_type = 'FINAL_VIDEO' AND a.mime_type = 'video/mp4'
        AND j.input_snapshot->>'revision_id' = v.id::text AND j.input_snapshot->>'project_hash' = v.project_hash
        AND j.output_snapshot #>> '{final_video,asset_id}' = a.id::text
        AND a.metadata->>'render_request_id' = r.id::text AND a.metadata->>'provider_render_id' = r.provider_render_id
        AND a.metadata->>'integrity_method' = 'storage-stream-sha256-v1'
        AND a.storage_bucket = 'production-videos'
        AND a.storage_path = 'production-videos/organizations/' || r.organization_id::text || '/artifacts/' || j.artifact_id::text
          || '/components/' || j.material_component_id::text || '/renders/' || r.id::text || '/final.mp4'
        AND a.id::text = p_report #>> '{integrity,assetId}' AND a.checksum = p_report #>> '{integrity,checksum}'
        AND a.file_size_bytes::text = p_report #>> '{integrity,sizeBytes}'
        AND i.result->>'checksum' = a.checksum AND i.result->>'assetId' = a.id::text
        AND v.manifest->>'conformance_reference_version' = '1'
        AND v.manifest->>'draft_document_hash' = p_report #>> '{integrity,documentHash}'
        AND v.manifest #>> '{conformance_contract,documentHash}' = p_report #>> '{integrity,documentHash}'
        AND (v.manifest #>> '{conformance_contract,schemaVersion}' NOT IN ('3','4') OR p_report->>'status' <> 'PASS' OR coalesce(
          p_report #>> '{comparison,visual,status}' = 'PASS'
          AND v.manifest #>> '{conformance_contract,visualMetrics,ssimPolicy}' = 'ssim-gaussian-11-coded-bt709-luma-v1'
          AND p_report #>> '{comparison,visual,ssim,policy}' = v.manifest #>> '{conformance_contract,visualMetrics,ssimPolicy}'
          AND (p_report #>> '{comparison,visual,ssim,minimumRequired}')::numeric = 0.995
          AND (p_report #>> '{comparison,visual,ssim,minimumRequired}')::numeric
            = (v.manifest #>> '{conformance_contract,visualMetrics,minimumSsim}')::numeric
          AND (p_report #>> '{comparison,visual,ssim,minimumObserved}')::numeric BETWEEN 0.995 AND 1
          AND (p_report #>> '{comparison,visual,ssim,checkedCheckpointCount}')::integer
            = jsonb_array_length(v.manifest #> '{conformance_contract,checkpoints}')
          AND (p_report #>> '{comparison,visual,requiredCheckpointCount}')::integer
            = jsonb_array_length(v.manifest #> '{conformance_contract,checkpoints}'), false))
        AND (v.manifest #>> '{conformance_contract,schemaVersion}' <> '4' OR p_report->>'status' <> 'PASS' OR coalesce(
          p_report #>> '{comparison,visual,textParity,status}' = 'PASS'
          AND v.manifest #>> '{conformance_contract,textParity,policy}' = 'text-region-rgb-shift-one-v1'
          AND v.manifest #>> '{conformance_contract,textParity,scope}' = 'NATIVE_TEXT_AND_CAPTIONS'
          AND p_report #>> '{comparison,visual,textParity,policy}' = v.manifest #>> '{conformance_contract,textParity,policy}'
          AND p_report #>> '{comparison,visual,textParity,scope}' = v.manifest #>> '{conformance_contract,textParity,scope}'
          AND (p_report #>> '{comparison,visual,textParity,checkedCheckpointCount}')::integer
            = jsonb_array_length(v.manifest #> '{conformance_contract,checkpoints}')
          AND (p_report #>> '{comparison,visual,textParity,requiredCheckpointCount}')::integer
            = jsonb_array_length(v.manifest #> '{conformance_contract,checkpoints}')
          AND (p_report #>> '{comparison,visual,textParity,checkedRegionCount}')::integer
            = (p_report #>> '{comparison,visual,textParity,expectedRegionCount}')::integer
          AND (p_report #>> '{comparison,visual,textParity,expectedRegionCount}')::integer
            = (SELECT coalesce(sum(jsonb_array_length(entry->'expectedTexts')), 0)
              FROM jsonb_array_elements(v.manifest #> '{conformance_contract,textParity,checkpoints}') entry), false))
        AND visual.bundle_sha256 = p_report #>> '{references,visualChecksum}'
        AND audio.bundle_sha256 = p_report #>> '{references,audioChecksum}'
        AND visual.project_hash = v.project_hash AND visual.document_hash = p_report #>> '{integrity,documentHash}'
        AND audio.receipt->>'projectHash' = v.project_hash AND audio.receipt->>'documentHash' = visual.document_hash
        AND (audio.receipt->>'schemaVersion' <> '3' OR (
          p_report #>> '{comparison,audioPlayback,policy,id}' = 'browser-av-clock-and-boundaries-v2'
          AND p_report #> '{comparison,audioPlayback,witness}' = audio.receipt->'playback'
          AND p_report #>> '{comparison,audioPlayback,status}' IN ('PASS','FAIL','INCOMPLETE')
          AND (p_report->>'status' <> 'PASS' OR (
            p_report #>> '{comparison,audioPlayback,status}' = 'PASS'
            AND p_report #>> '{comparison,audioPlayback,boundaries,status}' = 'PASS'
            AND p_report #>> '{comparison,audioPlayback,boundaries,policy}' = 'browser-media-boundaries-v1'
            AND coalesce((p_report #>> '{comparison,audioPlayback,boundaries,checkedClipCount}')::integer = (audio.receipt->>'clipCount')::integer, false)
            AND coalesce((p_report #>> '{comparison,audioPlayback,boundaries,expectedClipCount}')::integer = (audio.receipt->>'clipCount')::integer, false)
            AND audio.receipt #>> '{playback,boundaries,policy}' = 'browser-media-boundaries-v1'
            AND coalesce(jsonb_array_length(audio.receipt #> '{playback,boundaries,media}') = (audio.receipt->>'clipCount')::integer, false)
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(audio.receipt #> '{playback,boundaries,media}') boundary
              WHERE NOT coalesce(
                (boundary->>'playingEvents')::integer > 0 AND (boundary->>'stopEvents')::integer > 0
                AND (boundary->>'unexpectedStops')::integer = 0
                AND (boundary->>'sourceDurationSeconds')::numeric > 0
                AND (boundary->>'stopFrame')::numeric >= (boundary->>'firstPlayingFrame')::numeric
                AND abs(((boundary->>'firstPlayingFrame')::numeric - (audio.receipt #>> '{playback,originFrame}')::numeric) * 1000 / 48000
                  - (boundary #>> '{window,startSeconds}')::numeric * 1000)
                  + (audio.receipt #>> '{playback,quantumMilliseconds}')::numeric
                    <= 1000.0 / (v.manifest #>> '{conformance_contract,canvas,fps}')::numeric
                AND abs(((boundary->>'stopFrame')::numeric - (audio.receipt #>> '{playback,originFrame}')::numeric) * 1000 / 48000
                  - CASE WHEN (boundary #>> '{window,loop}')::boolean THEN (boundary #>> '{window,endSeconds}')::numeric
                    ELSE least((boundary #>> '{window,endSeconds}')::numeric, (boundary #>> '{window,startSeconds}')::numeric
                      + greatest(0, (boundary->>'sourceDurationSeconds')::numeric - (boundary #>> '{window,sourceOffsetSeconds}')::numeric)) END * 1000)
                  + (audio.receipt #>> '{playback,quantumMilliseconds}')::numeric
                    <= 1000.0 / (v.manifest #>> '{conformance_contract,canvas,fps}')::numeric,
              false)
            )
            AND coalesce((audio.receipt #>> '{playback,eventCount}')::numeric >= (audio.receipt->>'clipCount')::numeric, false)
            AND coalesce((audio.receipt #>> '{playback,maxClockDriftMilliseconds}')::numeric
              + abs((p_report #>> '{comparison,audioTiming,lagMilliseconds}')::numeric)
              + (audio.receipt #>> '{playback,quantumMilliseconds}')::numeric + 5 <= 20, false)
            AND coalesce((audio.receipt #>> '{playback,maxMediaDriftMilliseconds}')::numeric
              + (audio.receipt #>> '{playback,quantumMilliseconds}')::numeric
              <= 1000.0 / (v.manifest #>> '{conformance_contract,canvas,fps}')::numeric, false)
          ))
        ))
        AND p_report #>> '{comparison,video,sha256}' = a.checksum
        AND p_report #>> '{comparison,documentHash}' = visual.document_hash
        AND p_report #>> '{comparison,video,sizeBytes}' = a.file_size_bytes::text
    ) THEN RAISE EXCEPTION 'CONFORMANCE_JOB_REPORT_BINDING_INVALID'; END IF;
    UPDATE private.hyperframes_conformance_jobs SET status = 'SUCCEEDED',report = p_report,error_code = NULL,
      lease_token = NULL,lease_expires_at = NULL,updated_at = now() WHERE id = job.id;
  ELSE
    IF p_error_code IS NULL OR p_error_code !~ '^CONFORMANCE_JOB_[A-Z_]+$' THEN RAISE EXCEPTION 'CONFORMANCE_JOB_ERROR_INVALID'; END IF;
    UPDATE private.hyperframes_conformance_jobs SET
      status = CASE WHEN p_retryable AND job.attempts < 5 THEN 'PENDING' ELSE 'FAILED' END,
      next_attempt_at = now() + make_interval(secs => least(900,30 * (2 ^ (job.attempts - 1))::integer)),
      error_code = p_error_code,lease_token = NULL,lease_expires_at = NULL,updated_at = now() WHERE id = job.id;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.read_hyperframes_conformance_report(p_organization_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT j.report FROM private.hyperframes_conformance_jobs j
  WHERE j.organization_id = p_organization_id AND j.request_id = p_request_id AND j.status = 'SUCCEEDED';
$$;
REVOKE ALL ON FUNCTION public.claim_hyperframes_conformance_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_hyperframes_conformance_job(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_hyperframes_conformance_job(uuid,uuid,jsonb,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_hyperframes_conformance_report(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hyperframes_conformance_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_hyperframes_conformance_job(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_conformance_job(uuid,uuid,jsonb,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_conformance_report(uuid,uuid) TO service_role;
