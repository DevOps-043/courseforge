-- Durable cancellation and safe, tenant-scoped import telemetry.
ALTER TABLE public.hyperframes_render_requests
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS diagnostic_events jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION private.track_hyperframes_render_diagnostics()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, private AS $$
DECLARE v_events jsonb;
BEGIN
  -- A delayed poll, webhook or submission cannot revive a cancelled request.
  IF OLD.cancelled_at IS NOT NULL THEN RETURN NULL; END IF;
  IF NEW.provider_status IS DISTINCT FROM OLD.provider_status
    OR NEW.import_status IS DISTINCT FROM OLD.import_status
    OR NEW.provider_error IS DISTINCT FROM OLD.provider_error
    OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    v_events := OLD.diagnostic_events || jsonb_build_array(jsonb_build_object(
      'at', now(),
      'stage', CASE WHEN NEW.cancelled_at IS NOT NULL THEN 'cancelled'
        WHEN NEW.import_status <> 'NONE' THEN 'import_' || lower(NEW.import_status)
        ELSE lower(NEW.provider_status) END,
      'error', NEW.provider_error
    ));
    SELECT COALESCE(jsonb_agg(item ORDER BY ordinal), '[]'::jsonb) INTO NEW.diagnostic_events
    FROM jsonb_array_elements(v_events) WITH ORDINALITY AS e(item, ordinal)
    WHERE ordinal > jsonb_array_length(v_events) - 100;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER track_hyperframes_render_diagnostics
BEFORE UPDATE ON public.hyperframes_render_requests
FOR EACH ROW EXECUTE FUNCTION private.track_hyperframes_render_diagnostics();

CREATE OR REPLACE FUNCTION private.guard_cancelled_hyperframes_job()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, private AS $$
BEGIN
  IF OLD.provider = 'hyperframes' AND OLD.job_type = 'HYPERFRAMES_RENDER'
    AND OLD.status = 'CANCELLED' THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_cancelled_hyperframes_job
BEFORE UPDATE ON public.production_jobs
FOR EACH ROW EXECUTE FUNCTION private.guard_cancelled_hyperframes_job();

CREATE OR REPLACE FUNCTION private.guard_cancelled_hyperframes_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.hyperframes_render_requests
    WHERE id = NEW.render_request_id AND cancelled_at IS NOT NULL) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_cancelled_hyperframes_import
BEFORE INSERT OR UPDATE ON private.hyperframes_render_imports
FOR EACH ROW EXECUTE FUNCTION private.guard_cancelled_hyperframes_import();

CREATE OR REPLACE FUNCTION public.cancel_hyperframes_render(p_request_id uuid, p_organization_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $$
DECLARE v_request public.hyperframes_render_requests%ROWTYPE;
DECLARE v_job public.production_jobs%ROWTYPE;
DECLARE v_error jsonb := jsonb_build_object('source', 'user_cancellation', 'message',
  'Proceso cancelado por el usuario en Courseforge. El proveedor puede continuar el cómputo ya aceptado.', 'retryable', false);
BEGIN
  -- Match the finalizer's lock order: import -> request -> job.
  PERFORM i.id FROM private.hyperframes_render_imports i
  JOIN public.hyperframes_render_requests r ON r.id = i.render_request_id
  WHERE r.id = p_request_id AND r.organization_id = p_organization_id FOR UPDATE OF i;

  SELECT * INTO v_request FROM public.hyperframes_render_requests
  WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  IF v_request.id IS NULL THEN RETURN NULL; END IF;
  IF v_request.cancelled_at IS NOT NULL THEN RETURN 'CANCELLED'; END IF;
  SELECT * INTO v_job FROM public.production_jobs
  WHERE id = v_request.production_job_id AND organization_id = p_organization_id FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'render job not found'; END IF;
  IF v_job.status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN RETURN v_job.status; END IF;

  UPDATE private.hyperframes_render_imports SET status = 'FAILED', lease_token = NULL,
    lease_expires_at = NULL, last_error = v_error, updated_at = now()
  WHERE render_request_id = v_request.id;
  UPDATE public.hyperframes_render_requests SET cancelled_at = now(),
    -- FAILED is the terminal tombstone understood by existing webhook/RPC code.
    provider_status = CASE WHEN provider_status = 'COMPLETED' THEN 'COMPLETED' ELSE 'FAILED' END,
    import_status = 'FAILED', provider_error = v_error,
    reconcile_lease_token = NULL, reconcile_lease_expires_at = NULL, updated_at = now()
  WHERE id = v_request.id;
  UPDATE public.production_jobs SET status = 'CANCELLED', completed_at = now(),
    provider_error = v_error, progress = private.append_production_progress(progress, NULL, 'cancelled'), updated_at = now()
  WHERE id = v_job.id;
  RETURN 'CANCELLED';
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_hyperframes_render(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_hyperframes_render(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_hyperframes_import_diagnostics(p_request_id uuid, p_organization_id uuid)
RETURNS TABLE (uploaded_bytes bigint, source_size_bytes bigint, attempt_count integer,
  failure_count integer, next_attempt_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private AS $$
  SELECT i.uploaded_bytes, i.source_size_bytes, i.attempt_count, i.failure_count,
    CASE WHEN i.status IN ('QUEUED', 'RETRY_SCHEDULED') THEN i.next_attempt_at ELSE NULL END, i.updated_at
  FROM private.hyperframes_render_imports i
  JOIN public.hyperframes_render_requests r ON r.id = i.render_request_id
  WHERE r.id = p_request_id AND r.organization_id = p_organization_id;
$$;

REVOKE ALL ON FUNCTION public.get_hyperframes_import_diagnostics(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hyperframes_import_diagnostics(uuid, uuid) TO service_role;

-- Duplicate reconciliation must preserve retry backoff and terminal imports.
CREATE OR REPLACE FUNCTION public.queue_hyperframes_render_import(p_request_id uuid, p_provider_render_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, extensions AS $$
DECLARE v_request public.hyperframes_render_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM public.hyperframes_render_requests WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.provider_render_id IS DISTINCT FROM p_provider_render_id THEN
    RAISE EXCEPTION 'render request not found or provider id mismatch';
  END IF;
  IF v_request.cancelled_at IS NOT NULL OR v_request.import_status <> 'NONE' THEN RETURN; END IF;
  IF v_request.provider_status = 'FAILED' THEN RETURN; END IF;
  INSERT INTO private.hyperframes_render_imports(render_request_id, status)
    VALUES (p_request_id, 'QUEUED') ON CONFLICT (render_request_id) DO NOTHING;
  UPDATE public.hyperframes_render_requests SET provider_status = 'COMPLETED', import_status = 'QUEUED',
    next_reconcile_at = now() + interval '1 day', updated_at = now() WHERE id = p_request_id;
  UPDATE public.production_jobs SET status = 'WAITING_PROVIDER',
    progress = private.append_production_progress(progress, 90, 'provider_completed'), updated_at = now()
  WHERE id = v_request.production_job_id AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED');
END;
$$;
