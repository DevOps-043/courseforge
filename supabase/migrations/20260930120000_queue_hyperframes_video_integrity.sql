-- Opt-in deployment: requires the checksum RPC migration and a separately enabled worker.
-- Only new completed MP4 imports are queued; no historical backfill or QA approval.
CREATE TABLE private.hyperframes_video_integrity_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES public.hyperframes_render_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^VIDEO_INTEGRITY_[A-Z_]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL))
);
ALTER TABLE private.hyperframes_video_integrity_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_video_integrity_jobs FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX hyperframes_video_integrity_pending_idx
  ON private.hyperframes_video_integrity_jobs (next_attempt_at, created_at) WHERE status = 'PENDING';
CREATE INDEX hyperframes_video_integrity_running_idx
  ON private.hyperframes_video_integrity_jobs (lease_expires_at) WHERE status = 'RUNNING';

CREATE FUNCTION private.enqueue_hyperframes_video_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  IF NEW.provider_status = 'COMPLETED' AND NEW.import_status = 'COMPLETED'
    AND EXISTS (
      SELECT 1 FROM public.production_assets a JOIN public.production_jobs j ON j.id = a.production_job_id
      WHERE j.id = NEW.production_job_id AND j.organization_id = NEW.organization_id AND j.status = 'SUCCEEDED'
        AND a.organization_id = NEW.organization_id AND a.provider = 'hyperframes' AND a.asset_type = 'FINAL_VIDEO'
        AND a.mime_type = 'video/mp4' AND a.id::text = j.output_snapshot #>> '{final_video,asset_id}'
    ) THEN
    INSERT INTO private.hyperframes_video_integrity_jobs (organization_id, request_id)
    VALUES (NEW.organization_id, NEW.id) ON CONFLICT (request_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_hyperframes_video_integrity() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enqueue_hyperframes_video_integrity
AFTER INSERT OR UPDATE OF import_status, provider_status ON public.hyperframes_render_requests
FOR EACH ROW EXECUTE FUNCTION private.enqueue_hyperframes_video_integrity();

CREATE FUNCTION public.claim_hyperframes_video_integrity_job()
RETURNS TABLE (id uuid, organization_id uuid, request_id uuid, lease_token uuid, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_job private.hyperframes_video_integrity_jobs%ROWTYPE;
BEGIN
  -- Abandoned fifth attempts terminate, preventing permanently RUNNING rows.
  UPDATE private.hyperframes_video_integrity_jobs q
  SET status = 'FAILED', lease_token = NULL, lease_expires_at = NULL,
      error_code = 'VIDEO_INTEGRITY_LEASE_EXHAUSTED', updated_at = now()
  WHERE q.status = 'RUNNING' AND q.lease_expires_at <= now() AND q.attempts >= 5;

  SELECT q.* INTO v_job FROM private.hyperframes_video_integrity_jobs q
  WHERE q.attempts < 5 AND ((q.status = 'PENDING' AND q.next_attempt_at <= now())
    OR (q.status = 'RUNNING' AND q.lease_expires_at <= now()))
  ORDER BY q.next_attempt_at, q.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE private.hyperframes_video_integrity_jobs q
  SET status = 'RUNNING', attempts = q.attempts + 1, lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '30 minutes', updated_at = now()
  WHERE q.id = v_job.id RETURNING q.* INTO v_job;
  RETURN QUERY SELECT v_job.id, v_job.organization_id, v_job.request_id, v_job.lease_token, v_job.attempts;
END;
$$;

CREATE FUNCTION public.finish_hyperframes_video_integrity_job(
  p_job_id uuid, p_lease_token uuid, p_result jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_retryable boolean DEFAULT false
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE v_job private.hyperframes_video_integrity_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM private.hyperframes_video_integrity_jobs q
  WHERE q.id = p_job_id AND q.status = 'RUNNING' AND q.lease_token = p_lease_token
    AND q.lease_expires_at > now() FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN false; END IF;
  IF p_error_code IS NULL THEN
    IF p_result IS NULL OR p_result->>'checksum' IS NULL OR p_result->>'documentHash' IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.hyperframes_render_requests r
        JOIN public.production_assets a ON a.production_job_id = r.production_job_id
        JOIN public.video_composition_revisions v ON v.id = r.composition_revision_id
        WHERE r.id = v_job.request_id AND r.organization_id = v_job.organization_id
          AND r.import_status = 'COMPLETED' AND r.provider_status = 'COMPLETED'
          AND a.organization_id = v_job.organization_id AND v.organization_id = v_job.organization_id
          AND a.id::text = p_result->>'assetId' AND a.asset_type = 'FINAL_VIDEO' AND a.provider = 'hyperframes'
          AND a.checksum = p_result->>'checksum' AND a.checksum ~ '^[a-f0-9]{64}$'
          AND a.metadata->>'integrity_method' = 'storage-stream-sha256-v1'
          AND a.file_size_bytes::text = p_result->>'sizeBytes'
          AND v.manifest #>> '{conformance_contract,documentHash}' = p_result->>'documentHash'
      ) THEN RAISE EXCEPTION 'video integrity result mismatch'; END IF;
    UPDATE private.hyperframes_video_integrity_jobs SET status = 'SUCCEEDED',
      result = jsonb_build_object('assetId', p_result->>'assetId', 'checksum', p_result->>'checksum',
        'documentHash', p_result->>'documentHash', 'sizeBytes', p_result->'sizeBytes', 'verifiedAt', now()),
      error_code = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = v_job.id;
  ELSE
    IF p_error_code !~ '^VIDEO_INTEGRITY_[A-Z_]+$' OR p_result IS NOT NULL THEN
      RAISE EXCEPTION 'invalid video integrity failure';
    END IF;
    UPDATE private.hyperframes_video_integrity_jobs SET
      status = CASE WHEN p_retryable AND v_job.attempts < 5 THEN 'PENDING' ELSE 'FAILED' END,
      next_attempt_at = now() + make_interval(secs => LEAST(900, 30 * (2 ^ (v_job.attempts - 1))::integer)),
      error_code = p_error_code, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = v_job.id;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_hyperframes_video_integrity_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_hyperframes_video_integrity_job(uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hyperframes_video_integrity_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_video_integrity_job(uuid, uuid, jsonb, text, boolean) TO service_role;
