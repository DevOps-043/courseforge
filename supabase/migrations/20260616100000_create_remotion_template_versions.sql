-- ============================================================================
-- Migration: Create Remotion template bundle versions
-- Date: 2026-06-16
-- Description:
--   Stores auditable external Remotion bundle uploads. V1 validates and reviews
--   bundles only; rendering continues to use internal compositions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.remotion_template_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.remotion_templates(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'UPLOADED',
  storage_path text NOT NULL,
  original_file_name text,
  bundle_hash text,
  entry_point text,
  manifest jsonb,
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at timestamp with time zone,
  rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT remotion_template_versions_pkey PRIMARY KEY (id),
  CONSTRAINT remotion_template_versions_template_version_unique UNIQUE (template_id, version_number),
  CONSTRAINT remotion_template_versions_status_check CHECK (
    status IN (
      'UPLOADED',
      'VALIDATING',
      'VALIDATION_FAILED',
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
      'DEPRECATED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_remotion_template_versions_template
  ON public.remotion_template_versions (template_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_template_versions_org_status
  ON public.remotion_template_versions (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_remotion_template_versions_hash
  ON public.remotion_template_versions (bundle_hash);

ALTER TABLE public.remotion_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_remotion_template_versions"
  ON public.remotion_template_versions
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_remotion_template_versions"
  ON public.remotion_template_versions
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "update_remotion_template_versions"
  ON public.remotion_template_versions
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.remotion_template_versions IS
  'Auditable external Remotion bundle uploads. V1 supports validation and review only; bundles are not executed.';

COMMENT ON COLUMN public.remotion_template_versions.validation_report IS
  'Structured safe validation report. Do not store secrets or raw stack traces.';
