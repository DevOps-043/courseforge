-- ============================================================================
-- Migration: Create Remotion template build records
-- Date: 2026-06-27
-- Description:
--   Stores auditable build outputs for approved custom Remotion bundle versions
--   so preview/render flows can reuse compiled artifacts instead of rebuilding
--   opaquely from the source ZIP cache.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.remotion_template_builds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL
    REFERENCES public.remotion_template_versions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'BUILDING',
  bundle_hash text NOT NULL,
  build_hash text,
  entrypoint_path text,
  generated_entrypoint_path text,
  serve_url text,
  build_output_storage_path text,
  composition_id text,
  composition_ids jsonb,
  export_mode text NOT NULL DEFAULT 'component',
  build_log text,
  built_at timestamp with time zone,
  build_failed_at timestamp with time zone,
  build_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT remotion_template_builds_pkey PRIMARY KEY (id),
  CONSTRAINT remotion_template_builds_status_check CHECK (
    status IN ('BUILDING', 'BUILT', 'BUILD_FAILED')
  ),
  CONSTRAINT remotion_template_builds_export_mode_check CHECK (
    export_mode IN ('component', 'root')
  )
);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_version
  ON public.remotion_template_builds (template_version_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_org_status
  ON public.remotion_template_builds (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_bundle_hash
  ON public.remotion_template_builds (bundle_hash);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_reuse
  ON public.remotion_template_builds (
    template_version_id,
    bundle_hash,
    composition_id,
    export_mode,
    status,
    created_at DESC
  );

ALTER TABLE public.remotion_template_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_remotion_template_builds"
  ON public.remotion_template_builds
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_remotion_template_builds"
  ON public.remotion_template_builds
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "update_remotion_template_builds"
  ON public.remotion_template_builds
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.remotion_template_builds IS
  'Auditable build records for custom Remotion template bundles.';

COMMENT ON COLUMN public.remotion_template_builds.bundle_hash IS
  'SHA-256 hash of the source ZIP bundle.';

COMMENT ON COLUMN public.remotion_template_builds.build_hash IS
  'SHA-256 hash of the compiled build output when available.';

COMMENT ON COLUMN public.remotion_template_builds.serve_url IS
  'Local Remotion serve URL/path for development builds. Do not rely on this as a durable production URL.';

COMMENT ON COLUMN public.remotion_template_builds.build_output_storage_path IS
  'Durable storage path for compiled build output when uploaded to object storage.';
