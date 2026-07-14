-- ============================================================================
-- Migration: Render workers for SofLIA - Engine desktop Remotion renders
-- Date: 2026-07-10
-- Description: Adds limited-token local worker registration plus claim/output
--   metadata on production_jobs. Workers never receive service role keys.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.render_workers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  platform text,
  arch text,
  app_version text,
  token_hash text NOT NULL UNIQUE,
  token_last4 text NOT NULL,
  status text NOT NULL DEFAULT 'LINKED',
  last_heartbeat_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT render_workers_pkey PRIMARY KEY (id),
  CONSTRAINT render_workers_status_check CHECK (
    status IN ('LINKED', 'ONLINE', 'BUSY', 'OFFLINE', 'REVOKED')
  )
);

CREATE INDEX IF NOT EXISTS idx_render_workers_org_status
  ON public.render_workers (organization_id, status);

ALTER TABLE public.production_jobs
  ADD COLUMN IF NOT EXISTS worker_id uuid REFERENCES public.render_workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS output_checksum text,
  ADD COLUMN IF NOT EXISTS logs_ref text;

CREATE INDEX IF NOT EXISTS idx_production_jobs_desktop_worker_claim
  ON public.production_jobs (organization_id, status, job_type, created_at)
  WHERE job_type = 'REMOTION_RENDER';

CREATE INDEX IF NOT EXISTS idx_production_jobs_worker_id
  ON public.production_jobs (worker_id)
  WHERE worker_id IS NOT NULL;

ALTER TABLE public.render_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_render_workers"
  ON public.render_workers
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_render_workers"
  ON public.render_workers
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_render_workers"
  ON public.render_workers
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

