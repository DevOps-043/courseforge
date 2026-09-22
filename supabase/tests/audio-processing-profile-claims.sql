-- Run after 20260922120000. Test fixtures and claims are rolled back.
BEGIN;

DO $$
DECLARE
  v_artifact_id uuid := gen_random_uuid();
  v_base_job uuid := gen_random_uuid();
  v_neural_job uuid := gen_random_uuid();
  v_future_job uuid := gen_random_uuid();
  v_claimed uuid;
BEGIN
  INSERT INTO public.artifacts (id, idea_central)
  VALUES (v_artifact_id, 'Audio capability claim test');

  INSERT INTO public.production_jobs
    (id, artifact_id, job_type, provider, idempotency_key, input_snapshot, created_at)
  VALUES
    (v_base_job, v_artifact_id, 'AUDIO_PROCESSING', 'ffmpeg', gen_random_uuid()::text,
      '{"profile":{"id":"voice-course-v1"}}'::jsonb, '1970-01-01 00:00:01+00'),
    (v_neural_job, v_artifact_id, 'AUDIO_PROCESSING', 'ffmpeg', gen_random_uuid()::text,
      '{"profile":{"id":"voice-clean-neural-dfn3-v1"}}'::jsonb, '1970-01-01 00:00:02+00'),
    (v_future_job, v_artifact_id, 'AUDIO_PROCESSING', 'ffmpeg', gen_random_uuid()::text,
      '{"profile":{"id":"voice-clean-neural-rnnoise-v1"}}'::jsonb, '1970-01-01 00:00:03+00');

  SELECT id INTO v_claimed FROM public.claim_audio_processing_jobs(1, 900);
  IF v_claimed IS DISTINCT FROM v_base_job THEN
    RAISE EXCEPTION 'Legacy worker claimed a non-baseline profile';
  END IF;

  SELECT id INTO v_claimed FROM public.claim_audio_processing_jobs_by_profile(
    ARRAY['voice-clean-neural-dfn3-v1'], 1, 900
  );
  IF v_claimed IS DISTINCT FROM v_neural_job THEN
    RAISE EXCEPTION 'Neural worker did not claim its matching profile';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.claim_audio_processing_jobs_by_profile(ARRAY['voice-course-v1'], 1, 900)
    WHERE id = v_base_job
  ) THEN
    RAISE EXCEPTION 'Baseline job was claimed twice';
  END IF;

  IF (SELECT status FROM public.production_jobs WHERE id = v_future_job) <> 'PENDING' THEN
    RAISE EXCEPTION 'Unknown profile was claimed without a capable worker';
  END IF;

  IF has_function_privilege('anon', 'public.claim_audio_processing_jobs_by_profile(text[],integer,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.claim_audio_processing_jobs_by_profile(text[],integer,integer)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.claim_audio_processing_jobs_by_profile(text[],integer,integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Audio claim RPC grants are incorrect';
  END IF;
END;
$$;

ROLLBACK;
