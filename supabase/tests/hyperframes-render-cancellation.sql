-- Run against an isolated fixture database after the diagnostics migration.
-- The Node QA runner builds the fixture; never run fixtures in production.
DO $$
DECLARE
  v_org uuid := '00000000-0000-4000-8000-000000000001';
  v_other_org uuid := '00000000-0000-4000-8000-000000000002';
  v_request uuid := '00000000-0000-4000-8000-000000000003';
  v_job uuid := '00000000-0000-4000-8000-000000000004';
  v_import uuid := '00000000-0000-4000-8000-000000000005';
  v_lease uuid := '00000000-0000-4000-8000-000000000006';
  v_actual text;
  v_count integer;
  v_cancelled timestamptz;
BEGIN
  INSERT INTO public.production_jobs(id, organization_id, status, provider, job_type)
    VALUES(v_job, v_org, 'RUNNING', 'hyperframes', 'HYPERFRAMES_RENDER');
  INSERT INTO public.hyperframes_render_requests(id, organization_id, production_job_id, provider_render_id, provider_status, import_status)
    VALUES(v_request, v_org, v_job, 'provider-test', 'COMPLETED', 'UPLOADING');
  INSERT INTO private.hyperframes_render_imports(id, render_request_id, status, lease_token, uploaded_bytes, source_size_bytes, storage_path)
    VALUES(v_import, v_request, 'UPLOADING', v_lease, 1024, 1024, 'fixture.mp4');

  IF public.cancel_hyperframes_render(v_request, v_other_org) IS NOT NULL THEN
    RAISE EXCEPTION 'cross-tenant cancellation';
  END IF;
  SELECT count(*) INTO v_count FROM public.get_hyperframes_import_diagnostics(v_request, v_other_org);
  IF v_count <> 0 THEN RAISE EXCEPTION 'cross-tenant telemetry'; END IF;
  SELECT count(*) INTO v_count FROM public.get_hyperframes_import_diagnostics(v_request, v_org);
  IF v_count <> 1 THEN RAISE EXCEPTION 'missing telemetry'; END IF;

  IF public.cancel_hyperframes_render(v_request, v_org) <> 'CANCELLED' THEN RAISE EXCEPTION 'cancel failed'; END IF;
  SELECT cancelled_at INTO v_cancelled FROM public.hyperframes_render_requests WHERE id = v_request;
  IF v_cancelled IS NULL THEN RAISE EXCEPTION 'missing cancellation timestamp'; END IF;
  IF public.cancel_hyperframes_render(v_request, v_org) <> 'CANCELLED' THEN RAISE EXCEPTION 'cancel not idempotent'; END IF;

  -- Simulate late submission, poll and webhook writes using their actual tables.
  UPDATE public.hyperframes_render_requests SET provider_status = 'RUNNING', import_status = 'QUEUED', provider_error = NULL WHERE id = v_request;
  UPDATE public.production_jobs SET status = 'SUCCEEDED', completed_at = now() WHERE id = v_job;
  UPDATE private.hyperframes_render_imports SET status = 'UPLOADING', lease_token = v_lease WHERE id = v_import;
  PERFORM public.queue_hyperframes_render_import(v_request, 'provider-test');
  SELECT status INTO v_actual FROM public.production_jobs WHERE id = v_job;
  IF v_actual <> 'CANCELLED' THEN RAISE EXCEPTION 'late job revived'; END IF;
  SELECT status INTO v_actual FROM private.hyperframes_render_imports WHERE id = v_import;
  IF v_actual <> 'FAILED' THEN RAISE EXCEPTION 'late import revived'; END IF;
  SELECT import_status INTO v_actual FROM public.hyperframes_render_requests WHERE id = v_request;
  IF v_actual <> 'FAILED' THEN RAISE EXCEPTION 'late request revived'; END IF;
  BEGIN
    PERFORM public.complete_hyperframes_render_import(v_import, v_lease, 'https://example.test/final.mp4', 230);
    RAISE EXCEPTION 'stale finalizer accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'invalid or expired import lease' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_count FROM public.production_assets;
  IF v_count <> 0 THEN RAISE EXCEPTION 'cancelled video published'; END IF;

  -- Retry backoff survives repeated enqueue calls.
  INSERT INTO public.production_jobs(id, organization_id, status, provider, job_type)
    VALUES(gen_random_uuid(), v_org, 'RETRY_SCHEDULED', 'hyperframes', 'HYPERFRAMES_RENDER') RETURNING id INTO v_job;
  INSERT INTO public.hyperframes_render_requests(id, organization_id, production_job_id, provider_render_id, provider_status, import_status)
    VALUES(gen_random_uuid(), v_org, v_job, 'retry-test', 'COMPLETED', 'RETRY_SCHEDULED') RETURNING id INTO v_request;
  INSERT INTO private.hyperframes_render_imports(id, render_request_id, status, next_attempt_at)
    VALUES(gen_random_uuid(), v_request, 'RETRY_SCHEDULED', now() + interval '15 minutes') RETURNING id INTO v_import;
  PERFORM public.queue_hyperframes_render_import(v_request, 'retry-test');
  IF EXISTS(SELECT 1 FROM private.hyperframes_render_imports WHERE id = v_import AND next_attempt_at < now() + interval '14 minutes') THEN
    RAISE EXCEPTION 'backoff reset';
  END IF;

  -- Error history is durable even when the next update clears the current error.
  UPDATE public.hyperframes_render_requests SET provider_error = '{"message":"Unauthorized"}' WHERE id = v_request;
  UPDATE public.hyperframes_render_requests SET provider_error = NULL WHERE id = v_request;
  IF NOT EXISTS (SELECT 1 FROM public.hyperframes_render_requests WHERE id = v_request
    AND diagnostic_events @> '[{"error":{"message":"Unauthorized"}}]') THEN RAISE EXCEPTION 'error history lost'; END IF;

  UPDATE public.production_jobs SET status = 'SUCCEEDED' WHERE id = v_job;
  IF public.cancel_hyperframes_render(v_request, v_org) <> 'SUCCEEDED' THEN RAISE EXCEPTION 'completed job cancelled'; END IF;
  IF has_function_privilege('authenticated', 'public.cancel_hyperframes_render(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'unsafe authenticated RPC access';
  END IF;
END;
$$;
