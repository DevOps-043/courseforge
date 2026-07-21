-- ============================================================================
-- Migration: Desktop worker template builds
-- Date: 2026-07-17
-- Description:
--   Lets desktop workers claim and complete custom Remotion template build
--   records directly from remotion_template_builds. This keeps template build
--   audit data in its domain table instead of forcing non-render work into
--   production_jobs.
-- ============================================================================

ALTER TABLE public.remotion_template_builds
  ADD COLUMN IF NOT EXISTS worker_id uuid REFERENCES public.render_workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS output_checksum text;

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_worker_claim
  ON public.remotion_template_builds (organization_id, status, cloud_provider, lease_expires_at, created_at)
  WHERE status = 'BUILDING' AND cloud_provider = 'desktop_worker';

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_worker_id
  ON public.remotion_template_builds (worker_id)
  WHERE worker_id IS NOT NULL;
