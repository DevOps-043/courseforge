-- Durable, browser-independent orchestration for HeyGen HyperFrames renders.
--
-- The provider render remains asynchronous. Short-lived workers reconcile the
-- provider state and copy the final video to Storage in resumable chunks.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

ALTER TABLE public.hyperframes_render_requests
  ADD COLUMN IF NOT EXISTS callback_id text,
  ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_reconcile_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reconcile_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconcile_lease_token uuid,
  ADD COLUMN IF NOT EXISTS reconcile_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_status text NOT NULL DEFAULT 'NONE';

UPDATE public.hyperframes_render_requests
SET callback_id = id::text
WHERE callback_id IS NULL;

ALTER TABLE public.hyperframes_render_requests
  ALTER COLUMN callback_id SET NOT NULL,
  ALTER COLUMN callback_id SET DEFAULT gen_random_uuid()::text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hyperframes_render_requests_callback_unique'
  ) THEN
    ALTER TABLE public.hyperframes_render_requests
      ADD CONSTRAINT hyperframes_render_requests_callback_unique UNIQUE (callback_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hyperframes_render_requests_reconcile_retry_check'
  ) THEN
    ALTER TABLE public.hyperframes_render_requests
      ADD CONSTRAINT hyperframes_render_requests_reconcile_retry_check
      CHECK (reconcile_retry_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hyperframes_render_requests_import_status_check'
  ) THEN
    ALTER TABLE public.hyperframes_render_requests
      ADD CONSTRAINT hyperframes_render_requests_import_status_check
      CHECK (import_status IN (
        'NONE', 'QUEUED', 'UPLOADING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED'
      ));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_hyperframes_render_requests_reconcile_due
  ON public.hyperframes_render_requests (next_reconcile_at, created_at)
  WHERE provider_render_id IS NOT NULL
    AND provider_status IN ('PENDING', 'RUNNING');

CREATE TABLE IF NOT EXISTS private.heygen_webhook_secrets (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint_id text NOT NULL,
  callback_url text NOT NULL,
  encrypted_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heygen_webhook_secrets_callback_https_check
    CHECK (callback_url ~ '^https://')
);

ALTER TABLE private.heygen_webhook_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.heygen_webhook_secrets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.configure_heygen_webhook(
  p_organization_id uuid,
  p_endpoint_id text,
  p_callback_url text,
  p_encrypted_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
BEGIN
  IF p_endpoint_id IS NULL OR trim(p_endpoint_id) = ''
    OR p_callback_url !~ '^https://'
    OR p_encrypted_secret IS NULL OR trim(p_encrypted_secret) = '' THEN
    RAISE EXCEPTION 'invalid HeyGen webhook configuration';
  END IF;

  INSERT INTO private.heygen_webhook_secrets (
    organization_id, endpoint_id, callback_url, encrypted_secret
  ) VALUES (
    p_organization_id, p_endpoint_id, p_callback_url, p_encrypted_secret
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET endpoint_id = EXCLUDED.endpoint_id,
      callback_url = EXCLUDED.callback_url,
      encrypted_secret = EXCLUDED.encrypted_secret,
      updated_at = now();

  INSERT INTO public.heygen_workspace_connections (
    organization_id, default_callback_url, webhook_endpoint_id,
    webhook_secret_ref, metadata
  ) VALUES (
    p_organization_id, p_callback_url, p_endpoint_id,
    'private.heygen_webhook_secrets',
    jsonb_build_object('webhook_configured_at', now())
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET default_callback_url = EXCLUDED.default_callback_url,
      webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
      webhook_secret_ref = EXCLUDED.webhook_secret_ref,
      metadata = COALESCE(public.heygen_workspace_connections.metadata, '{}'::jsonb)
        || EXCLUDED.metadata,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.configure_heygen_webhook(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_heygen_webhook(uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.clear_heygen_webhook(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
BEGIN
  DELETE FROM private.heygen_webhook_secrets
  WHERE organization_id = p_organization_id;

  UPDATE public.heygen_workspace_connections
  SET default_callback_url = NULL,
      webhook_endpoint_id = NULL,
      webhook_secret_ref = NULL,
      metadata = COALESCE(metadata, '{}'::jsonb) - 'webhook_configured_at',
      updated_at = now()
  WHERE organization_id = p_organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_heygen_webhook(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_heygen_webhook(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_heygen_webhook_verification_context(
  p_callback_id text
)
RETURNS TABLE (
  organization_id uuid,
  encrypted_secret text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
  SELECT request.organization_id, secret.encrypted_secret
  FROM public.hyperframes_render_requests AS request
  JOIN private.heygen_webhook_secrets AS secret
    ON secret.organization_id = request.organization_id
  WHERE request.callback_id = p_callback_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_heygen_webhook_verification_context(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_heygen_webhook_verification_context(text)
  TO service_role;

CREATE TABLE IF NOT EXISTS private.heygen_webhook_events (
  event_id text PRIMARY KEY,
  render_request_id uuid REFERENCES public.hyperframes_render_requests(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload_sha256 text NOT NULL,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT heygen_webhook_events_hash_check
    CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT heygen_webhook_events_outcome_check
    CHECK (outcome IN ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'IGNORED'))
);

ALTER TABLE private.heygen_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.heygen_webhook_events FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.hyperframes_render_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_request_id uuid NOT NULL UNIQUE
    REFERENCES public.hyperframes_render_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'QUEUED',
  storage_bucket text NOT NULL DEFAULT 'production-videos',
  storage_path text,
  source_size_bytes bigint,
  source_content_type text,
  tus_upload_url text,
  uploaded_bytes bigint NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hyperframes_render_imports_status_check
    CHECK (status IN ('QUEUED', 'UPLOADING', 'RETRY_SCHEDULED', 'COMPLETED', 'FAILED')),
  CONSTRAINT hyperframes_render_imports_size_check
    CHECK (source_size_bytes IS NULL OR (source_size_bytes > 0 AND source_size_bytes <= 524288000)),
  CONSTRAINT hyperframes_render_imports_uploaded_check
    CHECK (uploaded_bytes >= 0),
  CONSTRAINT hyperframes_render_imports_attempt_check
    CHECK (attempt_count >= 0),
  CONSTRAINT hyperframes_render_imports_failure_check
    CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hyperframes_render_imports_due
  ON private.hyperframes_render_imports (next_attempt_at, created_at)
  WHERE status IN ('QUEUED', 'UPLOADING', 'RETRY_SCHEDULED');

ALTER TABLE private.hyperframes_render_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.hyperframes_render_imports FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS production_assets_final_video_per_job_uidx
  ON public.production_assets (production_job_id, asset_type)
  WHERE production_job_id IS NOT NULL AND asset_type = 'FINAL_VIDEO';

-- Render tracking is backend-owned. Browser users can observe their tenant's
-- requests through RLS/Realtime but cannot forge provider state transitions.
DROP POLICY IF EXISTS "org_insert_hyperframes_render_requests"
  ON public.hyperframes_render_requests;
DROP POLICY IF EXISTS "org_update_hyperframes_render_requests"
  ON public.hyperframes_render_requests;

CREATE OR REPLACE FUNCTION private.append_production_progress(
  p_progress jsonb,
  p_percent integer,
  p_stage text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
AS $$
  WITH previous AS (
    SELECT value, ordinality
    FROM jsonb_array_elements(COALESCE(p_progress, '[]'::jsonb)) WITH ORDINALITY
    WHERE ordinality > GREATEST(jsonb_array_length(COALESCE(p_progress, '[]'::jsonb)) - 49, 0)
  )
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object(
      'at', clock_timestamp(),
      'percent', CASE
        WHEN p_percent IS NULL THEN NULL
        ELSE LEAST(GREATEST(p_percent, 0), 100)
      END,
      'stage', LEFT(p_stage, 120)
    ))
  FROM previous;
$$;

REVOKE ALL ON FUNCTION private.append_production_progress(jsonb, integer, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_hyperframes_reconciliations(
  p_limit integer DEFAULT 8,
  p_lease_seconds integer DEFAULT 90
)
RETURNS TABLE (
  request_id uuid,
  lease_token uuid,
  organization_id uuid,
  production_job_id uuid,
  provider_render_id text,
  retry_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT request.id
    FROM public.hyperframes_render_requests AS request
    WHERE request.provider_render_id IS NOT NULL
      AND request.provider_status IN ('PENDING', 'RUNNING')
      AND request.next_reconcile_at <= now()
      AND (
        request.reconcile_lease_expires_at IS NULL
        OR request.reconcile_lease_expires_at < now()
      )
    ORDER BY request.next_reconcile_at, request.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 25)
  ), claimed AS (
    UPDATE public.hyperframes_render_requests AS request
    SET reconcile_lease_token = gen_random_uuid(),
        reconcile_lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 300)),
        updated_at = now()
    FROM candidates
    WHERE request.id = candidates.id
    RETURNING request.id, request.reconcile_lease_token, request.organization_id,
      request.production_job_id, request.provider_render_id, request.reconcile_retry_count
  )
  SELECT claimed.id, claimed.reconcile_lease_token, claimed.organization_id,
    claimed.production_job_id, claimed.provider_render_id, claimed.reconcile_retry_count
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_hyperframes_reconciliations(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hyperframes_reconciliations(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_hyperframes_reconciliation(
  p_request_id uuid,
  p_lease_token uuid,
  p_provider_status text,
  p_provider_render_id text,
  p_failure_message text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_request public.hyperframes_render_requests%ROWTYPE;
  v_job public.production_jobs%ROWTYPE;
  v_status text := upper(trim(p_provider_status));
BEGIN
  SELECT * INTO v_request
  FROM public.hyperframes_render_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL OR v_request.reconcile_lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'invalid or expired reconciliation lease';
  END IF;

  IF v_request.provider_render_id IS DISTINCT FROM p_provider_render_id THEN
    RAISE EXCEPTION 'provider render id mismatch';
  END IF;

  SELECT * INTO v_job
  FROM public.production_jobs
  WHERE id = v_request.production_job_id
  FOR UPDATE;

  -- A provider response can arrive after a webhook/import transaction has
  -- already advanced the request. Terminal provider/import states are
  -- monotonic: a stale in-flight reconciliation must never resurrect or
  -- downgrade them.
  IF v_request.provider_status IN ('COMPLETED', 'FAILED')
    OR v_request.import_status IN ('COMPLETED', 'FAILED') THEN
    UPDATE public.hyperframes_render_requests
    SET reconcile_lease_token = NULL,
        reconcile_lease_expires_at = NULL,
        updated_at = now()
    WHERE id = p_request_id;
    RETURN 'IGNORED_STALE';
  END IF;

  IF v_status IN ('QUEUED', 'PENDING', 'RENDERING', 'RUNNING') THEN
    UPDATE public.hyperframes_render_requests
    SET provider_status = CASE WHEN v_status IN ('QUEUED', 'PENDING') THEN 'PENDING' ELSE 'RUNNING' END,
        last_provider_check_at = now(),
        last_polled_at = now(),
        poll_attempts = poll_attempts + 1,
        next_reconcile_at = now() + interval '2 minutes',
        reconcile_retry_count = 0,
        reconcile_lease_token = NULL,
        reconcile_lease_expires_at = NULL,
        provider_error = NULL,
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE public.production_jobs
    SET status = 'WAITING_PROVIDER',
        provider_job_id = p_provider_render_id,
        output_snapshot = COALESCE(output_snapshot, '{}'::jsonb)
          || jsonb_build_object('provider_render_id', p_provider_render_id, 'provider_status', lower(v_status)),
        progress = private.append_production_progress(
          progress,
          NULL,
          lower(v_status)
        ),
        updated_at = now()
    WHERE id = v_job.id;
    RETURN 'WAIT';
  END IF;

  IF v_status = 'COMPLETED' THEN
    INSERT INTO private.hyperframes_render_imports (render_request_id, status)
    VALUES (p_request_id, 'QUEUED')
    ON CONFLICT (render_request_id) DO UPDATE
      SET status = CASE
            WHEN private.hyperframes_render_imports.status IN ('QUEUED', 'UPLOADING', 'COMPLETED')
              THEN private.hyperframes_render_imports.status
            ELSE 'QUEUED'
          END,
          next_attempt_at = now(),
          updated_at = now();

    UPDATE public.hyperframes_render_requests
    SET provider_status = 'COMPLETED',
        import_status = CASE
          WHEN import_status IN ('QUEUED', 'UPLOADING', 'COMPLETED') THEN import_status
          ELSE 'QUEUED'
        END,
        last_provider_check_at = now(),
        last_polled_at = now(),
        poll_attempts = poll_attempts + 1,
        reconcile_retry_count = 0,
        reconcile_lease_token = NULL,
        reconcile_lease_expires_at = NULL,
        provider_error = NULL,
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE public.production_jobs
    SET status = CASE WHEN status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'WAITING_PROVIDER' END,
        provider_job_id = p_provider_render_id,
        output_snapshot = COALESCE(output_snapshot, '{}'::jsonb)
          || jsonb_build_object('provider_render_id', p_provider_render_id, 'provider_status', 'completed'),
        progress = private.append_production_progress(progress, 90, 'provider_completed'),
        updated_at = now()
    WHERE id = v_job.id;
    RETURN 'IMPORT_QUEUED';
  END IF;

  IF v_status = 'FAILED' THEN
    UPDATE public.hyperframes_render_requests
    SET provider_status = 'FAILED',
        import_status = 'FAILED',
        last_provider_check_at = now(),
        reconcile_lease_token = NULL,
        reconcile_lease_expires_at = NULL,
        provider_error = jsonb_build_object(
          'message', LEFT(COALESCE(p_failure_message, 'HeyGen reported a failed HyperFrames render.'), 500),
          'source', 'hyperframes_reconciliation'
        ),
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE public.production_jobs
    SET status = 'FAILED',
        failed_at = now(),
        provider_error = jsonb_build_object(
          'message', LEFT(COALESCE(p_failure_message, 'HeyGen reported a failed HyperFrames render.'), 500),
          'source', 'hyperframes_reconciliation'
        ),
        progress = private.append_production_progress(progress, 100, 'failed'),
        updated_at = now()
    WHERE id = v_job.id;
    RETURN 'FAIL';
  END IF;

  RAISE EXCEPTION 'unsupported provider status: %', v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_hyperframes_reconciliation(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hyperframes_reconciliation(uuid, uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reschedule_hyperframes_reconciliation(
  p_request_id uuid,
  p_lease_token uuid,
  p_error_message text,
  p_retry_after_seconds integer DEFAULT 60
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_retry_count integer;
BEGIN
  UPDATE public.hyperframes_render_requests
  SET reconcile_retry_count = reconcile_retry_count + 1,
      next_reconcile_at = now() + make_interval(secs => LEAST(GREATEST(p_retry_after_seconds, 15), 900)),
      reconcile_lease_token = NULL,
      reconcile_lease_expires_at = NULL,
      provider_error = jsonb_build_object(
        'message', LEFT(p_error_message, 500),
        'source', 'hyperframes_reconciliation',
        'retryable', true
      ),
      updated_at = now()
  WHERE id = p_request_id
    AND reconcile_lease_token = p_lease_token
  RETURNING reconcile_retry_count INTO v_retry_count;

  IF v_retry_count IS NULL THEN
    RAISE EXCEPTION 'invalid or expired reconciliation lease';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_hyperframes_reconciliation(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_hyperframes_reconciliation(uuid, uuid, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.queue_hyperframes_render_import(
  p_request_id uuid,
  p_provider_render_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_request public.hyperframes_render_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.hyperframes_render_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.id IS NULL OR v_request.provider_render_id IS DISTINCT FROM p_provider_render_id THEN
    RAISE EXCEPTION 'render request not found or provider id mismatch';
  END IF;

  IF v_request.provider_status = 'FAILED' OR v_request.import_status = 'FAILED' THEN
    RAISE EXCEPTION 'render request is terminal';
  END IF;

  INSERT INTO private.hyperframes_render_imports (render_request_id, status)
  VALUES (p_request_id, 'QUEUED')
  ON CONFLICT (render_request_id) DO UPDATE
    SET status = CASE
          WHEN private.hyperframes_render_imports.status IN ('QUEUED', 'UPLOADING', 'COMPLETED')
            THEN private.hyperframes_render_imports.status
          ELSE 'QUEUED'
        END,
        next_attempt_at = now(),
        updated_at = now();

  UPDATE public.hyperframes_render_requests
  SET provider_status = 'COMPLETED',
      import_status = CASE
        WHEN import_status IN ('QUEUED', 'UPLOADING', 'COMPLETED') THEN import_status
        ELSE 'QUEUED'
      END,
      next_reconcile_at = now() + interval '1 day',
      updated_at = now()
  WHERE id = p_request_id;

  UPDATE public.production_jobs
  SET status = CASE WHEN status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'WAITING_PROVIDER' END,
      progress = private.append_production_progress(progress, 90, 'provider_completed'),
      updated_at = now()
  WHERE id = v_request.production_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_hyperframes_render_import(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_hyperframes_render_import(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.record_hyperframes_webhook_event(
  p_event_id text,
  p_event_type text,
  p_callback_id text,
  p_provider_render_id text,
  p_payload_sha256 text,
  p_failure_message text DEFAULT NULL
)
RETURNS TABLE (
  duplicate boolean,
  request_id uuid,
  organization_id uuid,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_request public.hyperframes_render_requests%ROWTYPE;
  v_inserted_count integer;
  v_action text;
BEGIN
  SELECT * INTO v_request
  FROM public.hyperframes_render_requests
  WHERE callback_id = p_callback_id
  FOR UPDATE;

  IF v_request.id IS NULL OR v_request.provider_render_id IS DISTINCT FROM p_provider_render_id THEN
    RAISE EXCEPTION 'webhook correlation failed';
  END IF;

  INSERT INTO private.heygen_webhook_events (
    event_id, render_request_id, event_type, payload_sha256, outcome
  ) VALUES (
    LEFT(p_event_id, 255), v_request.id, LEFT(p_event_type, 120), p_payload_sha256, 'RECEIVED'
  )
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count = 0 THEN
    RETURN QUERY SELECT true, v_request.id, v_request.organization_id, 'DUPLICATE'::text;
    RETURN;
  END IF;

  IF p_event_type = 'hyperframes_video.success' THEN
    IF v_request.provider_status = 'FAILED' OR v_request.import_status = 'FAILED' THEN
      -- Terminal failures require an explicit operator retry; an out-of-order
      -- success delivery must not silently restart the state machine.
      v_action := 'IGNORED';
    ELSE
      PERFORM public.queue_hyperframes_render_import(v_request.id, p_provider_render_id);
      v_action := 'IMPORT_QUEUED';
    END IF;
  ELSIF p_event_type = 'hyperframes_video.fail' THEN
    IF v_request.import_status = 'COMPLETED' THEN
      -- A late/out-of-order failure event cannot roll back a published import.
      v_action := 'IGNORED';
    ELSE
      UPDATE public.hyperframes_render_requests
      SET provider_status = 'FAILED',
          import_status = 'FAILED',
          webhook_received_at = now(),
          provider_error = jsonb_build_object(
            'message', LEFT(COALESCE(p_failure_message, 'HeyGen reported a failed HyperFrames render.'), 500),
            'source', 'heygen_webhook'
          ),
          updated_at = now()
      WHERE id = v_request.id;

      UPDATE public.production_jobs
      SET status = 'FAILED',
          failed_at = now(),
          provider_error = jsonb_build_object(
            'message', LEFT(COALESCE(p_failure_message, 'HeyGen reported a failed HyperFrames render.'), 500),
            'source', 'heygen_webhook'
          ),
          progress = private.append_production_progress(progress, 100, 'failed'),
          updated_at = now()
      WHERE id = v_request.production_job_id;
      v_action := 'FAIL';
    END IF;
  ELSE
    v_action := 'IGNORED';
  END IF;

  UPDATE public.hyperframes_render_requests
  SET webhook_received_at = now(), updated_at = now()
  WHERE id = v_request.id;

  UPDATE private.heygen_webhook_events
  SET outcome = CASE WHEN v_action = 'IGNORED' THEN 'IGNORED' ELSE 'PROCESSED' END,
      processed_at = now()
  WHERE event_id = p_event_id;

  RETURN QUERY SELECT false, v_request.id, v_request.organization_id, v_action;
END;
$$;

REVOKE ALL ON FUNCTION public.record_hyperframes_webhook_event(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_webhook_event(text, text, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_hyperframes_render_imports(
  p_limit integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  import_id uuid,
  lease_token uuid,
  request_id uuid,
  organization_id uuid,
  production_job_id uuid,
  provider_render_id text,
  artifact_id uuid,
  component_id uuid,
  created_by uuid,
  storage_bucket text,
  storage_path text,
  source_size_bytes bigint,
  source_content_type text,
  tus_upload_url text,
  uploaded_bytes bigint,
  attempt_count integer,
  failure_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_import_ids uuid[];
BEGIN
  SELECT array_agg(candidate.id)
  INTO v_import_ids
  FROM (
    SELECT pending_import.id
    FROM private.hyperframes_render_imports AS pending_import
    WHERE pending_import.status IN ('QUEUED', 'UPLOADING', 'RETRY_SCHEDULED')
      AND pending_import.next_attempt_at <= now()
      AND (pending_import.lease_expires_at IS NULL OR pending_import.lease_expires_at < now())
    ORDER BY pending_import.next_attempt_at, pending_import.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 5)
  ) AS candidate;

  IF COALESCE(array_length(v_import_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  UPDATE private.hyperframes_render_imports AS pending_import
  SET status = 'UPLOADING',
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 60), 360)),
      attempt_count = pending_import.attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE pending_import.id = ANY(v_import_ids);

  UPDATE public.hyperframes_render_requests AS request
  SET import_status = 'UPLOADING', updated_at = now()
  WHERE request.id IN (
    SELECT pending_import.render_request_id
    FROM private.hyperframes_render_imports AS pending_import
    WHERE pending_import.id = ANY(v_import_ids)
  );

  UPDATE public.production_jobs AS job
  SET status = CASE WHEN job.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'RUNNING' END,
      progress = CASE
        WHEN job.status = 'SUCCEEDED' THEN job.progress
        ELSE private.append_production_progress(job.progress, 92, 'importing')
      END,
      updated_at = now()
  WHERE job.id IN (
    SELECT request.production_job_id
    FROM public.hyperframes_render_requests AS request
    JOIN private.hyperframes_render_imports AS pending_import
      ON pending_import.render_request_id = request.id
    WHERE pending_import.id = ANY(v_import_ids)
  );

  RETURN QUERY
  SELECT pending_import.id, pending_import.lease_token, request.id, request.organization_id,
    request.production_job_id, request.provider_render_id, job.artifact_id,
    job.material_component_id, job.created_by, pending_import.storage_bucket,
    pending_import.storage_path, pending_import.source_size_bytes, pending_import.source_content_type,
    pending_import.tus_upload_url, pending_import.uploaded_bytes, pending_import.attempt_count,
    pending_import.failure_count
  FROM private.hyperframes_render_imports AS pending_import
  JOIN public.hyperframes_render_requests AS request ON request.id = pending_import.render_request_id
  JOIN public.production_jobs AS job ON job.id = request.production_job_id
  WHERE pending_import.id = ANY(v_import_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_hyperframes_render_imports(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_hyperframes_render_imports(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.save_hyperframes_import_progress(
  p_import_id uuid,
  p_lease_token uuid,
  p_storage_path text,
  p_source_size_bytes bigint,
  p_source_content_type text,
  p_tus_upload_url text,
  p_uploaded_bytes bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_render_request_id uuid;
  v_production_job_id uuid;
BEGIN
  UPDATE private.hyperframes_render_imports
  SET storage_path = p_storage_path,
      source_size_bytes = p_source_size_bytes,
      source_content_type = p_source_content_type,
      tus_upload_url = p_tus_upload_url,
      uploaded_bytes = p_uploaded_bytes,
      lease_expires_at = now() + interval '5 minutes',
      last_error = NULL,
      updated_at = now()
  WHERE id = p_import_id
    AND lease_token = p_lease_token
    AND status = 'UPLOADING'
  RETURNING render_request_id INTO v_render_request_id;

  IF v_render_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid or expired import lease';
  END IF;

  SELECT production_job_id INTO v_production_job_id
  FROM public.hyperframes_render_requests
  WHERE id = v_render_request_id;

  UPDATE public.production_jobs
  SET progress = private.append_production_progress(
        progress,
        90 + LEAST(floor((p_uploaded_bytes::numeric / p_source_size_bytes::numeric) * 9)::integer, 9),
        'importing'
      ),
      updated_at = now()
  WHERE id = v_production_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_hyperframes_import_progress(uuid, uuid, text, bigint, text, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_hyperframes_import_progress(uuid, uuid, text, bigint, text, text, bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_hyperframes_import_checkpoint(
  p_import_id uuid,
  p_lease_token uuid,
  p_retry_after_seconds integer DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
BEGIN
  UPDATE private.hyperframes_render_imports
  SET status = 'QUEUED',
      next_attempt_at = now() + make_interval(secs => LEAST(GREATEST(p_retry_after_seconds, 5), 60)),
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = p_import_id
    AND lease_token = p_lease_token
    AND status = 'UPLOADING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired import lease';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.release_hyperframes_import_checkpoint(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_hyperframes_import_checkpoint(uuid, uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_hyperframes_render_import(
  p_import_id uuid,
  p_lease_token uuid,
  p_public_url text,
  p_duration_seconds numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_import private.hyperframes_render_imports%ROWTYPE;
  v_request public.hyperframes_render_requests%ROWTYPE;
  v_job public.production_jobs%ROWTYPE;
  v_asset_id uuid;
  v_duration integer;
BEGIN
  SELECT * INTO v_import
  FROM private.hyperframes_render_imports
  WHERE id = p_import_id
  FOR UPDATE;

  IF v_import.id IS NULL OR v_import.lease_token IS DISTINCT FROM p_lease_token
    OR v_import.status <> 'UPLOADING' THEN
    RAISE EXCEPTION 'invalid or expired import lease';
  END IF;

  IF v_import.storage_path IS NULL OR v_import.source_size_bytes IS NULL
    OR v_import.uploaded_bytes <> v_import.source_size_bytes THEN
    RAISE EXCEPTION 'import is incomplete';
  END IF;

  SELECT * INTO v_request
  FROM public.hyperframes_render_requests
  WHERE id = v_import.render_request_id
  FOR UPDATE;

  SELECT * INTO v_job
  FROM public.production_jobs
  WHERE id = v_request.production_job_id
  FOR UPDATE;

  IF v_job.material_component_id IS NULL OR v_job.organization_id IS NULL THEN
    RAISE EXCEPTION 'production job is missing component context';
  END IF;

  v_duration := CASE
    WHEN p_duration_seconds IS NULL THEN NULL
    ELSE GREATEST(round(p_duration_seconds)::integer, 1)
  END;

  SELECT id INTO v_asset_id
  FROM public.production_assets
  WHERE production_job_id = v_job.id AND asset_type = 'FINAL_VIDEO'
  FOR UPDATE;

  IF v_asset_id IS NULL THEN
    INSERT INTO public.production_assets (
      artifact_id, asset_type, created_by, duration_seconds, external_url,
      file_size_bytes, material_component_id, metadata, mime_type,
      organization_id, production_job_id, provider, public_url, qa_status,
      storage_bucket, storage_path
    ) VALUES (
      v_job.artifact_id, 'FINAL_VIDEO', v_job.created_by, v_duration, NULL,
      v_import.source_size_bytes, v_job.material_component_id,
      jsonb_build_object(
        'provider_render_id', v_request.provider_render_id,
        'render_request_id', v_request.id,
        'imported_at', now(),
        'import_protocol', 'tus-resumable'
      ),
      v_import.source_content_type, v_job.organization_id, v_job.id,
      'hyperframes', p_public_url, 'READY_FOR_QA', v_import.storage_bucket,
      v_import.storage_bucket || '/' || v_import.storage_path
    )
    RETURNING id INTO v_asset_id;
  END IF;

  UPDATE public.material_components
  SET assets = (
        (COALESCE(assets, '{}'::jsonb)
          - 'final_video_assembly_stale'
          - 'final_video_layout_stale')
        || jsonb_strip_nulls(jsonb_build_object(
          'final_video_asset_provider', 'hyperframes',
          'final_video_source', 'hyperframes_cloud',
          'final_video_storage_path', v_import.storage_bucket || '/' || v_import.storage_path,
          'final_video_url', p_public_url,
          'production_status', 'COMPLETED',
          'updated_at', now(),
          'video_duration', v_duration
        ))
      )
  WHERE id = v_job.material_component_id;

  UPDATE public.production_jobs
  SET status = 'SUCCEEDED',
      completed_at = now(),
      failed_at = NULL,
      provider_error = NULL,
      output_snapshot = COALESCE(output_snapshot, '{}'::jsonb)
        || jsonb_build_object(
          'provider_render_id', v_request.provider_render_id,
          'provider_status', 'completed',
          'final_video', jsonb_build_object(
            'asset_id', v_asset_id,
            'file_size_bytes', v_import.source_size_bytes,
            'public_url', p_public_url,
            'storage_path', v_import.storage_bucket || '/' || v_import.storage_path
          )
        ),
      progress = private.append_production_progress(progress, 100, 'completed'),
      updated_at = now()
  WHERE id = v_job.id;

  UPDATE public.hyperframes_render_requests
  SET provider_status = 'COMPLETED',
      import_status = 'COMPLETED',
      provider_error = NULL,
      updated_at = now()
  WHERE id = v_request.id;

  UPDATE private.hyperframes_render_imports
  SET status = 'COMPLETED',
      completed_at = now(),
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = v_import.id;

  RETURN v_asset_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_hyperframes_render_import(uuid, uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_hyperframes_render_import(uuid, uuid, text, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reschedule_hyperframes_render_import(
  p_import_id uuid,
  p_lease_token uuid,
  p_error_message text,
  p_retry_after_seconds integer DEFAULT 60,
  p_terminal boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_request_id uuid;
  v_job_id uuid;
  v_status text := CASE WHEN p_terminal THEN 'FAILED' ELSE 'RETRY_SCHEDULED' END;
BEGIN
  UPDATE private.hyperframes_render_imports
  SET status = v_status,
      failure_count = failure_count + 1,
      next_attempt_at = now() + make_interval(secs => LEAST(GREATEST(p_retry_after_seconds, 15), 1800)),
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error = jsonb_build_object(
        'message', LEFT(p_error_message, 500),
        'retryable', NOT p_terminal
      ),
      updated_at = now()
  WHERE id = p_import_id
    AND lease_token = p_lease_token
  RETURNING render_request_id INTO v_request_id;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid or expired import lease';
  END IF;

  UPDATE public.hyperframes_render_requests
  SET import_status = v_status,
      provider_error = jsonb_build_object(
        'message', LEFT(p_error_message, 500),
        'source', 'hyperframes_import',
        'retryable', NOT p_terminal
      ),
      updated_at = now()
  WHERE id = v_request_id
  RETURNING production_job_id INTO v_job_id;

  UPDATE public.production_jobs
  SET status = CASE WHEN p_terminal THEN 'FAILED' ELSE 'RETRY_SCHEDULED' END,
      failed_at = CASE WHEN p_terminal THEN now() ELSE failed_at END,
      provider_error = jsonb_build_object(
        'message', LEFT(p_error_message, 500),
        'source', 'hyperframes_import',
        'retryable', NOT p_terminal
      ),
      progress = private.append_production_progress(
        progress,
        CASE WHEN p_terminal THEN 100 ELSE 92 END,
        CASE WHEN p_terminal THEN 'import_failed' ELSE 'import_retry_scheduled' END
      ),
      updated_at = now()
  WHERE id = v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_hyperframes_render_import(uuid, uuid, text, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_hyperframes_render_import(uuid, uuid, text, integer, boolean)
  TO service_role;

-- Cron calls this wrapper only when deployment secrets have been provisioned in
-- Supabase Vault. Missing secrets result in a no-op rather than a failed job.
CREATE OR REPLACE FUNCTION private.invoke_courseforge_edge_function(p_function_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, vault, net, extensions
AS $$
DECLARE
  v_project_url text;
  v_invocation_key text;
  v_request_id bigint;
BEGIN
  IF p_function_name NOT IN ('reconcile-hyperframes-renders', 'import-hyperframes-video') THEN
    RAISE EXCEPTION 'edge function is not allow-listed';
  END IF;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'courseforge_project_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_invocation_key
  FROM vault.decrypted_secrets
  WHERE name = 'courseforge_edge_invocation_key'
  LIMIT 1;

  IF v_project_url IS NULL OR v_invocation_key IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-courseforge-worker-key', v_invocation_key
    ),
    body := jsonb_build_object('source', 'supabase_cron'),
    timeout_milliseconds := 10000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION private.invoke_courseforge_edge_function(text)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('courseforge-reconcile-hyperframes');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

SELECT cron.schedule(
  'courseforge-reconcile-hyperframes',
  '* * * * *',
  $$SELECT private.invoke_courseforge_edge_function('reconcile-hyperframes-renders');$$
);

DO $$
BEGIN
  PERFORM cron.unschedule('courseforge-import-hyperframes-video');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

SELECT cron.schedule(
  'courseforge-import-hyperframes-video',
  '30 seconds',
  $$SELECT private.invoke_courseforge_edge_function('import-hyperframes-video');$$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'hyperframes_render_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.hyperframes_render_requests;
    END IF;
  END IF;
END
$$;

COMMENT ON TABLE public.hyperframes_render_requests IS
  'Durable HeyGen HyperFrames render tracking. Webhooks are primary; scheduled reconciliation is the recovery path.';
COMMENT ON TABLE private.hyperframes_render_imports IS
  'Private resumable-import queue. TUS upload URLs and worker leases are never exposed through RLS.';
COMMENT ON TABLE private.heygen_webhook_events IS
  'Minimal idempotency ledger for signed HeyGen webhook deliveries; raw payloads are intentionally not retained.';
