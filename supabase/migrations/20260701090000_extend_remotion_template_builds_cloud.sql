-- ============================================================================
-- Migration: Extend Remotion template builds for cloud build/runtime metadata
-- Date: 2026-07-01
-- Description:
--   Adds provider-neutral cloud build fields so custom Remotion bundles can be
--   promoted from local preview/sandbox artifacts to durable Lambda-ready sites.
-- ============================================================================

ALTER TABLE public.remotion_template_builds
  ADD COLUMN IF NOT EXISTS cloud_provider text,
  ADD COLUMN IF NOT EXISTS source_storage_path text,
  ADD COLUMN IF NOT EXISTS site_name text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS build_log_storage_path text,
  ADD COLUMN IF NOT EXISTS security_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_build_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_status_detail text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_provider_build
  ON public.remotion_template_builds (cloud_provider, provider_build_id);

CREATE INDEX IF NOT EXISTS idx_remotion_template_builds_cloud_ready
  ON public.remotion_template_builds (
    template_version_id,
    bundle_hash,
    composition_id,
    status,
    cloud_provider,
    created_at DESC
  );

COMMENT ON COLUMN public.remotion_template_builds.cloud_provider IS
  'Cloud builder/provider used for this build, for example aws-codebuild.';

COMMENT ON COLUMN public.remotion_template_builds.source_storage_path IS
  'Durable source ZIP path used by the cloud build.';

COMMENT ON COLUMN public.remotion_template_builds.site_name IS
  'Remotion Lambda site name or equivalent durable site identifier.';

COMMENT ON COLUMN public.remotion_template_builds.region IS
  'Cloud region where the build/site is expected to run.';

COMMENT ON COLUMN public.remotion_template_builds.build_log_storage_path IS
  'Durable path or URL for sanitized cloud build logs.';

COMMENT ON COLUMN public.remotion_template_builds.security_profile IS
  'Non-secret security metadata for the isolated build execution profile.';

COMMENT ON COLUMN public.remotion_template_builds.provider_build_id IS
  'Provider-specific build execution id, such as an AWS CodeBuild build id.';
