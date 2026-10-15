-- Analysis-only jobs reuse profile-routed leases. No media replacement or new asset.
CREATE OR REPLACE FUNCTION public.complete_audio_waveform_job(
  p_job_id uuid, p_lease_token uuid, p_manifest jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.production_jobs%ROWTYPE;
  v_asset public.production_assets%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_job FROM public.production_jobs
    WHERE id = p_job_id AND job_type = 'AUDIO_PROCESSING' AND provider = 'ffmpeg'
      AND status = 'RUNNING' AND input_snapshot #>> '{profile,id}' = 'waveform-analysis-v2'
      AND audio_processing_lease_token = p_lease_token AND audio_processing_lease_expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid waveform lease'; END IF;
  SELECT * INTO v_asset FROM public.production_assets
    WHERE id = (v_job.input_snapshot #>> '{source,assetId}')::uuid
      AND organization_id = v_job.organization_id AND material_component_id = v_job.material_component_id
      AND checksum = v_job.input_snapshot #>> '{source,checksum}'
      AND qa_status NOT IN ('ARCHIVED', 'REJECTED') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'waveform source changed'; END IF;
  IF p_manifest IS NOT NULL AND (
    p_manifest->>'contract_version' IS DISTINCT FROM '2'
    OR p_manifest->>'storage_bucket' IS DISTINCT FROM 'production-assets'
    OR p_manifest->>'source_checksum' IS DISTINCT FROM v_asset.checksum
    OR COALESCE(p_manifest->>'checksum', '') !~ '^[a-f0-9]{64}$'
    OR p_manifest->>'storage_path' IS DISTINCT FROM
      'organizations/' || v_job.organization_id::text || '/audio-analysis/' || (p_manifest->>'checksum') || '/waveform-v2.json'
  ) THEN RAISE EXCEPTION 'invalid waveform manifest'; END IF;
  v_status := CASE WHEN p_manifest IS NULL THEN 'NO_AUDIO' ELSE 'READY' END;
  UPDATE public.production_assets SET metadata = COALESCE(metadata, '{}'::jsonb) ||
    jsonb_build_object('waveform_analysis', jsonb_build_object('status', v_status,
      'source_checksum', v_asset.checksum, 'contract_version', 2), 'waveform', p_manifest)
    WHERE id = v_asset.id;
  UPDATE public.production_jobs SET status = 'SUCCEEDED', completed_at = now(), updated_at = now(),
    output_snapshot = jsonb_build_object('source_asset_id', v_asset.id, 'status', v_status, 'waveform', p_manifest),
    audio_processing_lease_token = NULL, audio_processing_lease_expires_at = NULL
    WHERE id = v_job.id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_audio_waveform_job(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_audio_waveform_job(uuid, uuid, jsonb) TO service_role;

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

  -- Recover only analysis jobs; treatment profiles retain their existing behavior.
  UPDATE public.production_jobs SET status = 'FAILED', failed_at = v_now, updated_at = v_now,
    audio_processing_lease_token = NULL, audio_processing_lease_expires_at = NULL,
    provider_error = jsonb_build_object('code', 'WAVEFORM_LEASE_EXHAUSTED', 'retryable', false)
    WHERE job_type = 'AUDIO_PROCESSING' AND provider = 'ffmpeg' AND status = 'RUNNING'
      AND input_snapshot #>> '{profile,id}' = 'waveform-analysis-v2'
      AND 'waveform-analysis-v2' = ANY(p_profile_ids)
      AND audio_processing_lease_expires_at <= v_now AND audio_processing_attempts >= 3;

  RETURN QUERY
  WITH eligible AS (
    SELECT job.id
    FROM public.production_jobs AS job
    WHERE job.job_type = 'AUDIO_PROCESSING'
      AND job.provider = 'ffmpeg'
      AND (job.status IN ('PENDING', 'RETRY_SCHEDULED') OR (
        job.status = 'RUNNING' AND job.input_snapshot #>> '{profile,id}' = 'waveform-analysis-v2'
        AND job.audio_processing_attempts < 3
      ))
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
