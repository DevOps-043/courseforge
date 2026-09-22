-- Route audio jobs only to workers that explicitly support the requested
-- profile. Keep the old RPC restricted to the baseline profile during rollout.
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

-- Existing workers can continue polling safely, but can only claim the
-- baseline profile. This wrapper can be removed after all workers migrate.
CREATE OR REPLACE FUNCTION public.claim_audio_processing_jobs(
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 900
)
RETURNS SETOF public.production_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.claim_audio_processing_jobs_by_profile(
    ARRAY['voice-course-v1']::text[], p_limit, p_lease_seconds
  );
$$;

REVOKE ALL ON FUNCTION public.claim_audio_processing_jobs(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_processing_jobs(integer, integer)
  TO service_role;
