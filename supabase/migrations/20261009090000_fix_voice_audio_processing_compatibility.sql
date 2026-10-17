-- Add input/output MIME types without changing bucket access policies.
-- Rollback: restore the previous completion function; retain added MIME types
-- until pending M4A/AAC jobs and output references have been reviewed.
BEGIN;
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT mime FROM unnest(allowed_mime_types || ARRAY['audio/mp4','audio/aac','application/json']::text[]) AS mime
)
WHERE id IN ('production-assets','production-render-sources') AND allowed_mime_types IS NOT NULL;

-- Preserve the integer-seconds RPC signature for old workers.
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
  v_duration_milliseconds integer;
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
    OR p_file_size_bytes IS NULL OR p_file_size_bytes <= 0 OR p_file_size_bytes > 52428800
    OR p_checksum IS NULL OR p_checksum !~ '^[a-f0-9]{64}$'
    OR p_duration_seconds IS NULL OR p_duration_seconds <= 0
    OR p_storage_path IS DISTINCT FROM format('organizations/%s/audio-processing/%s/processed.m4a', v_job.organization_id, v_job.id)
  THEN
    RAISE EXCEPTION 'audio processing output is invalid';
  END IF;

  v_duration_milliseconds := CASE
    WHEN p_metadata->>'duration_milliseconds' ~ '^[0-9]{1,7}$'
      THEN (p_metadata->>'duration_milliseconds')::integer
    ELSE p_duration_seconds * 1000
  END;
  IF v_duration_milliseconds <= 0 OR v_duration_milliseconds > 1800000 THEN
    RAISE EXCEPTION 'audio processing duration is invalid';
  END IF;

  INSERT INTO public.production_assets (
    organization_id, artifact_id, production_job_id, material_lesson_id,
    material_component_id, lesson_id, module_id, asset_type, provider,
    storage_bucket, storage_path, public_url, mime_type, file_size_bytes,
    duration_seconds, duration_milliseconds, checksum, metadata, qa_status, created_by
  ) VALUES (
    v_job.organization_id, v_job.artifact_id, v_job.id, v_job.material_lesson_id,
    v_job.material_component_id, v_job.lesson_id, v_job.module_id, 'PROCESSED_AUDIO', 'ffmpeg',
    p_storage_bucket, p_storage_path, p_public_url, p_mime_type, p_file_size_bytes,
    p_duration_seconds, v_duration_milliseconds, p_checksum, COALESCE(p_metadata, '{}'::jsonb), 'READY_FOR_QA', v_job.created_by
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


-- Count claims independently of generic/manual production-job retries.
ALTER TABLE public.production_jobs ADD COLUMN IF NOT EXISTS audio_processing_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_audio_processing_jobs_by_profile(
  p_profile_ids text[],
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
  IF p_profile_ids IS NULL OR cardinality(p_profile_ids) NOT BETWEEN 1 AND 16
    OR EXISTS (
      SELECT 1 FROM unnest(p_profile_ids) AS profile_id
      WHERE profile_id IS NULL OR profile_id !~ '^[a-z0-9][a-z0-9-]{0,99}$'
    )
  THEN
    RAISE EXCEPTION 'supported audio profiles are required';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT job.id
    FROM public.production_jobs AS job
    WHERE job.job_type = 'AUDIO_PROCESSING'
      AND job.provider = 'ffmpeg'
      AND job.status IN ('PENDING', 'RETRY_SCHEDULED')
      AND job.input_snapshot #>> '{profile,id}' = ANY(p_profile_ids)
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
    audio_processing_attempts = job.audio_processing_attempts + 1,
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

REVOKE ALL ON FUNCTION public.claim_audio_processing_jobs_by_profile(text[], integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_processing_jobs_by_profile(text[], integer, integer)
  TO service_role;


COMMIT;
