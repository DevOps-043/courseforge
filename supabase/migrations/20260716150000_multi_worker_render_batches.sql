-- ============================================================================
-- Migration: Multi-worker render batches and worker capacity
-- Date: 2026-07-16
-- Description:
--   Adds non-destructive scheduling metadata for desktop render workers,
--   auditable render batches, and an atomic claim RPC for multi-worker queues.
-- ============================================================================

ALTER TABLE public.render_workers
  ADD COLUMN IF NOT EXISTS max_concurrent_jobs integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_capacity_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capacity_updated_at timestamp with time zone;

ALTER TABLE public.render_workers
  DROP CONSTRAINT IF EXISTS render_workers_max_concurrent_jobs_check;

ALTER TABLE public.render_workers
  ADD CONSTRAINT render_workers_max_concurrent_jobs_check
  CHECK (max_concurrent_jobs BETWEEN 1 AND 8);

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS preferred_worker_id uuid REFERENCES public.render_workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS assigned_strategy text NOT NULL DEFAULT 'AUTO',
  ADD COLUMN IF NOT EXISTS render_batch_id uuid;

ALTER TABLE public.production_jobs
  DROP CONSTRAINT IF EXISTS production_jobs_assigned_strategy_check;

ALTER TABLE public.production_jobs
  ADD CONSTRAINT production_jobs_assigned_strategy_check
  CHECK (assigned_strategy IN ('AUTO', 'MANUAL', 'LEGACY'));

CREATE TABLE IF NOT EXISTS public.production_render_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES public.artifacts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  assignment_mode text NOT NULL DEFAULT 'AUTO',
  default_template_id uuid REFERENCES public.remotion_templates(id) ON DELETE SET NULL,
  total_items integer NOT NULL DEFAULT 0,
  completed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_render_batches_pkey PRIMARY KEY (id),
  CONSTRAINT production_render_batches_status_check CHECK (
    status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT production_render_batches_assignment_mode_check CHECK (
    assignment_mode IN ('AUTO', 'MANUAL', 'MIXED')
  )
);

CREATE TABLE IF NOT EXISTS public.production_render_batch_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.production_render_batches(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES public.artifacts(id) ON DELETE CASCADE,
  material_component_id uuid NOT NULL REFERENCES public.material_components(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.remotion_templates(id) ON DELETE SET NULL,
  preferred_worker_id uuid REFERENCES public.render_workers(id) ON DELETE SET NULL,
  production_job_id uuid REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  error_sanitized text,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_render_batch_items_pkey PRIMARY KEY (id),
  CONSTRAINT production_render_batch_items_status_check CHECK (
    status IN ('QUEUED', 'WAITING_PROVIDER', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT production_render_batch_items_unique_component UNIQUE (batch_id, material_component_id)
);

ALTER TABLE public.production_jobs
  DROP CONSTRAINT IF EXISTS production_jobs_render_batch_id_fkey;

ALTER TABLE public.production_jobs
  ADD CONSTRAINT production_jobs_render_batch_id_fkey
  FOREIGN KEY (render_batch_id) REFERENCES public.production_render_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_render_workers_org_status_capacity
  ON public.render_workers (organization_id, status, max_concurrent_jobs);

CREATE INDEX IF NOT EXISTS idx_production_jobs_desktop_worker_lease
  ON public.production_jobs (organization_id, status, job_type, lease_expires_at, created_at)
  WHERE job_type = 'REMOTION_RENDER';

CREATE INDEX IF NOT EXISTS idx_production_jobs_preferred_worker
  ON public.production_jobs (preferred_worker_id)
  WHERE preferred_worker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_jobs_render_batch
  ON public.production_jobs (render_batch_id)
  WHERE render_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_render_batches_org_artifact
  ON public.production_render_batches (organization_id, artifact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_render_batch_items_batch
  ON public.production_render_batch_items (batch_id, status, created_at);

ALTER TABLE public.production_render_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_render_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_production_render_batches"
  ON public.production_render_batches
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_production_render_batches"
  ON public.production_render_batches
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_production_render_batches"
  ON public.production_render_batches
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_production_render_batch_items"
  ON public.production_render_batch_items
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_production_render_batch_items"
  ON public.production_render_batch_items
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_production_render_batch_items"
  ON public.production_render_batch_items
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE OR REPLACE FUNCTION public.claim_desktop_render_jobs(
  p_worker_id uuid,
  p_organization_id uuid,
  p_limit integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 180
)
RETURNS SETOF public.production_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 8);
  v_now timestamp with time zone := now();
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT job.id
    FROM public.production_jobs AS job
    WHERE job.organization_id = p_organization_id
      AND job.job_type = 'REMOTION_RENDER'
      AND job.status IN ('PENDING', 'QUEUED', 'WAITING_PROVIDER')
      AND COALESCE(job.input_snapshot->>'renderProvider', '') = 'desktop_worker'
      AND (job.preferred_worker_id IS NULL OR job.preferred_worker_id = p_worker_id)
      AND (
        job.worker_id IS NULL
        OR job.worker_id = p_worker_id
        OR job.lease_expires_at IS NULL
        OR job.lease_expires_at <= v_now
      )
    ORDER BY
      CASE WHEN job.preferred_worker_id = p_worker_id THEN 0 ELSE 1 END,
      job.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.production_jobs AS job
  SET
    status = 'RUNNING',
    worker_id = p_worker_id,
    claimed_at = COALESCE(job.claimed_at, v_now),
    worker_heartbeat_at = v_now,
    lease_expires_at = v_now + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 180), 30), 900)),
    started_at = COALESCE(job.started_at, v_now),
    progress = jsonb_build_array(jsonb_build_object(
      'percent', 5,
      'message', 'Worker local tomo el job',
      'stage', 'desktop_worker_claimed',
      'provider', 'desktop_worker',
      'workerId', p_worker_id,
      'timestamp', v_now
    ))
  FROM eligible
  WHERE job.id = eligible.id
  RETURNING job.*;
END;
$$;

COMMENT ON FUNCTION public.claim_desktop_render_jobs(uuid, uuid, integer, integer) IS
  'Atomically claims desktop worker render jobs with SKIP LOCKED and short leases.';
