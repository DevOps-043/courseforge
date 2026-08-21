-- A material video can only have one active HyperFrames render. An advisory
-- transaction lock serializes simultaneous submissions without making this
-- migration fail if production already contains historical duplicate rows.
CREATE OR REPLACE FUNCTION public.prevent_concurrent_hyperframes_render()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.material_component_id IS NULL
    OR NEW.job_type <> 'HYPERFRAMES_RENDER'
    OR NEW.provider <> 'HYPERFRAMES'
    OR NEW.status NOT IN ('PENDING', 'RUNNING', 'WAITING_PROVIDER') THEN
    RETURN NEW;
  END IF;

  -- Let a job that was already active advance from uploading to provider wait.
  -- This also keeps pre-existing production rows operable during rollout.
  IF TG_OP = 'UPDATE'
    AND OLD.material_component_id = NEW.material_component_id
    AND OLD.job_type = NEW.job_type
    AND OLD.provider = NEW.provider
    AND OLD.status IN ('PENDING', 'RUNNING', 'WAITING_PROVIDER') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('hyperframes-render:' || NEW.material_component_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.production_jobs job
    WHERE job.material_component_id = NEW.material_component_id
      AND job.job_type = 'HYPERFRAMES_RENDER'
      AND job.provider = 'HYPERFRAMES'
      AND job.status IN ('PENDING', 'RUNNING', 'WAITING_PROVIDER')
      AND job.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'active_hyperframes_render_exists'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_concurrent_hyperframes_render() FROM PUBLIC;

DROP TRIGGER IF EXISTS prevent_concurrent_hyperframes_render_trigger
  ON public.production_jobs;
CREATE TRIGGER prevent_concurrent_hyperframes_render_trigger
  BEFORE INSERT OR UPDATE OF material_component_id, job_type, provider, status
  ON public.production_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_concurrent_hyperframes_render();

DROP INDEX IF EXISTS public.idx_hyperframes_render_requests_polling;
CREATE INDEX idx_hyperframes_render_requests_polling
  ON public.hyperframes_render_requests (provider_status, last_polled_at)
  WHERE provider_status IN ('UPLOADING', 'PENDING', 'RUNNING');
