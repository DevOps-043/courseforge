-- Durable, retryable outbox for publishing Courseforge artifacts to SofLIA.

ALTER TABLE public.publication_requests
  ADD COLUMN IF NOT EXISTS outbox_payload jsonb,
  ADD COLUMN IF NOT EXISTS outbox_payload_hash text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS publish_step text,
  ADD COLUMN IF NOT EXISTS publish_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_last_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'publication_requests_publish_attempt_nonnegative'
      AND conrelid = 'public.publication_requests'::regclass
  ) THEN
    ALTER TABLE public.publication_requests
      ADD CONSTRAINT publication_requests_publish_attempt_nonnegative
      CHECK (publish_attempt >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_publication_requests_outbox_recovery
  ON public.publication_requests (status, publish_step, publish_lease_expires_at, updated_at)
  WHERE status = 'READY' AND publish_step IN ('QUEUED', 'RUNNING');

CREATE UNIQUE INDEX IF NOT EXISTS uq_publication_requests_idempotency_key
  ON public.publication_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_publication_outbox(
  p_request_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.publication_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'Publication lease must be between 30 and 1800 seconds';
  END IF;

  RETURN QUERY
  UPDATE public.publication_requests AS target
  SET publish_step = 'RUNNING',
      publish_attempt = target.publish_attempt + 1,
      publish_started_at = v_now,
      publish_heartbeat_at = v_now,
      publish_lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      publish_last_error = NULL,
      updated_at = v_now
  WHERE target.id = p_request_id
    AND target.status = 'READY'
    AND target.outbox_payload IS NOT NULL
    AND target.outbox_payload_hash IS NOT NULL
    AND target.idempotency_key IS NOT NULL
    AND (
      target.publish_step = 'QUEUED'
      OR (
        target.publish_step = 'RUNNING'
        AND target.publish_lease_expires_at IS NOT NULL
        AND target.publish_lease_expires_at <= v_now
      )
    )
  RETURNING target.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_publication_outbox(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publication_outbox(uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_publication_outbox(uuid, integer)
  IS 'Atomically claims a queued SofLIA publication or reclaims it after lease expiry.';
