-- ============================================================================
-- Audio processing worker queue
--
-- FFmpeg jobs are executed by an isolated service-role worker, never by a web
-- request. A lease token makes completion conditional on the worker that won
-- the atomic claim, preventing late retries from publishing stale variants.
-- ============================================================================

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS audio_processing_lease_token uuid,
  ADD COLUMN IF NOT EXISTS audio_processing_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_production_jobs_audio_processing_claim
  ON public.production_jobs (status, audio_processing_lease_expires_at, created_at)
  WHERE job_type = 'AUDIO_PROCESSING' AND provider = 'ffmpeg';

CREATE OR REPLACE FUNCTION public.claim_audio_processing_jobs(
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 900
)
RETURNS SETOF public.production_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 4);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 900), 60), 3600);
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT job.id
    FROM public.production_jobs AS job
    WHERE job.job_type = 'AUDIO_PROCESSING'
      AND job.provider = 'ffmpeg'
      AND job.status IN ('PENDING', 'RETRY_SCHEDULED')
      AND (
        job.audio_processing_lease_expires_at IS NULL
        OR job.audio_processing_lease_expires_at <= v_now
      )
    ORDER BY job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.production_jobs AS job
  SET
    status = 'RUNNING',
    started_at = COALESCE(job.started_at, v_now),
    audio_processing_lease_token = gen_random_uuid(),
    audio_processing_lease_expires_at = v_now + make_interval(secs => v_lease_seconds),
    progress = jsonb_build_array(jsonb_build_object(
      'percent', 5,
      'stage', 'audio_processing_claimed',
      'provider', 'ffmpeg',
      'timestamp', v_now
    )),
    updated_at = v_now
  FROM eligible
  WHERE job.id = eligible.id
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_audio_processing_jobs(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_processing_jobs(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_audio_processing_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_public_url text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_checksum text,
  p_duration_seconds integer,
  p_metadata jsonb,
  p_output_snapshot jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.production_jobs%ROWTYPE;
  v_asset_id uuid;
BEGIN
  SELECT * INTO v_job
  FROM public.production_jobs
  WHERE id = p_job_id
    AND job_type = 'AUDIO_PROCESSING'
    AND provider = 'ffmpeg'
    AND status = 'RUNNING'
    AND audio_processing_lease_token = p_lease_token
    AND audio_processing_lease_expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audio processing lease is invalid or expired';
  END IF;

  IF p_storage_bucket <> 'production-assets'
    OR p_storage_path IS NULL OR p_storage_path !~ '^organizations/[0-9a-f-]+/audio-processing/[0-9a-f-]+/processed\.m4a$'
    OR p_mime_type <> 'audio/mp4'
    OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 524288000
    OR p_checksum IS NULL OR p_checksum !~ '^[a-f0-9]{64}$'
    OR p_duration_seconds IS NULL OR p_duration_seconds <= 0
  THEN
    RAISE EXCEPTION 'audio processing output is invalid';
  END IF;

  INSERT INTO public.production_assets (
    organization_id, artifact_id, production_job_id, material_lesson_id,
    material_component_id, lesson_id, module_id, asset_type, provider,
    storage_bucket, storage_path, public_url, mime_type, file_size_bytes,
    duration_seconds, checksum, metadata, qa_status, created_by
  ) VALUES (
    v_job.organization_id, v_job.artifact_id, v_job.id, v_job.material_lesson_id,
    v_job.material_component_id, v_job.lesson_id, v_job.module_id, 'PROCESSED_AUDIO', 'ffmpeg',
    p_storage_bucket, p_storage_path, p_public_url, p_mime_type, p_file_size_bytes,
    p_duration_seconds, p_checksum, COALESCE(p_metadata, '{}'::jsonb), 'READY_FOR_QA', v_job.created_by
  ) RETURNING id INTO v_asset_id;

  UPDATE public.production_jobs
  SET
    status = 'SUCCEEDED',
    completed_at = now(),
    output_checksum = p_checksum,
    output_snapshot = COALESCE(p_output_snapshot, '{}'::jsonb) || jsonb_build_object('asset_id', v_asset_id),
    audio_processing_lease_token = NULL,
    audio_processing_lease_expires_at = NULL,
    updated_at = now()
  WHERE id = v_job.id;

  RETURN v_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_audio_processing_job(uuid, uuid, text, text, text, text, bigint, text, integer, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_audio_processing_job(uuid, uuid, text, text, text, text, bigint, text, integer, jsonb, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_audio_processing_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_message text,
  p_retryable boolean DEFAULT false,
  p_retry_after_seconds integer DEFAULT 60
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_delay integer := LEAST(GREATEST(COALESCE(p_retry_after_seconds, 60), 15), 3600);
  v_updated integer;
BEGIN
  IF p_error_message IS NULL OR length(trim(p_error_message)) = 0 THEN
    RAISE EXCEPTION 'audio processing error message is required';
  END IF;

  UPDATE public.production_jobs
  SET
    status = CASE WHEN p_retryable THEN 'RETRY_SCHEDULED' ELSE 'FAILED' END,
    failed_at = CASE WHEN p_retryable THEN NULL ELSE now() END,
    provider_error = jsonb_build_object(
      'code', 'AUDIO_PROCESSING_FAILED',
      'message', left(trim(p_error_message), 500),
      'retryable', p_retryable,
      'timestamp', now()
    ),
    audio_processing_lease_token = NULL,
    audio_processing_lease_expires_at = CASE
      WHEN p_retryable THEN now() + make_interval(secs => v_retry_delay)
      ELSE NULL
    END,
    updated_at = now()
  WHERE id = p_job_id
    AND job_type = 'AUDIO_PROCESSING'
    AND provider = 'ffmpeg'
    AND status = 'RUNNING'
    AND audio_processing_lease_token = p_lease_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'audio processing lease is invalid or expired';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_audio_processing_job(uuid, uuid, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_audio_processing_job(uuid, uuid, text, boolean, integer)
  TO service_role;
