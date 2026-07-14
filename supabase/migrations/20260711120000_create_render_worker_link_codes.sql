-- ============================================================================
-- Migration: Temporary link codes for SofLIA - Engine desktop render workers
-- Date: 2026-07-11
-- Description: Adds one-time, short-lived worker link codes. Plain codes are
--   never stored; the CLI exchanges a code for a worker token through the API.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.render_worker_link_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid,
  code_hash text NOT NULL UNIQUE,
  code_last4 text NOT NULL,
  device_name text,
  platform text,
  arch text,
  app_version text,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  consumed_by_worker_id uuid REFERENCES public.render_workers(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT render_worker_link_codes_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_render_worker_link_codes_org_created
  ON public.render_worker_link_codes (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_render_worker_link_codes_available
  ON public.render_worker_link_codes (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.render_worker_link_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_render_worker_link_codes"
  ON public.render_worker_link_codes
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_render_worker_link_codes"
  ON public.render_worker_link_codes
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_render_worker_link_codes"
  ON public.render_worker_link_codes
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
