-- HyperFrames internal composition foundation.
-- This migration is additive: legacy Remotion data stays untouched until the
-- explicit cutover and destructive-retirement phase.

CREATE TABLE IF NOT EXISTS public.video_compositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  material_component_id uuid REFERENCES public.material_components(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  active_revision_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_compositions_status_check
    CHECK (status IN ('DRAFT', 'READY_FOR_PREVIEW', 'READY_FOR_RENDER', 'ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS idx_video_compositions_org_component
  ON public.video_compositions (organization_id, material_component_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.video_composition_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id uuid NOT NULL REFERENCES public.video_compositions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  generation_mode text NOT NULL CHECK (generation_mode IN ('AGENT_ASSISTED', 'AUTOMATIC')),
  format text NOT NULL DEFAULT 'hyperframes-html-v1',
  entry_point text NOT NULL,
  project_storage_bucket text NOT NULL DEFAULT 'production-assets',
  project_storage_path text NOT NULL,
  project_archive_size_bytes bigint NOT NULL CHECK (project_archive_size_bytes > 0 AND project_archive_size_bytes <= 209715200),
  project_hash text NOT NULL CHECK (project_hash ~ '^[a-f0-9]{64}$'),
  variables_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_revisions_unique_number UNIQUE (composition_id, revision_number),
  CONSTRAINT video_composition_revisions_unique_hash UNIQUE (composition_id, project_hash)
);

ALTER TABLE public.video_compositions
  ADD CONSTRAINT video_compositions_active_revision_fkey
  FOREIGN KEY (active_revision_id) REFERENCES public.video_composition_revisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_video_composition_revisions_org_composition
  ON public.video_composition_revisions (organization_id, composition_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS public.video_composition_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  production_asset_id uuid NOT NULL REFERENCES public.production_assets(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  source_storage_path text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  mime_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_assets_unique_asset UNIQUE (composition_revision_id, production_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_assets_revision
  ON public.video_composition_assets (composition_revision_id);

CREATE TABLE IF NOT EXISTS public.hyperframes_render_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  production_job_id uuid NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
  composition_revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  archive_size_bytes bigint NOT NULL CHECK (archive_size_bytes >= 0 AND archive_size_bytes <= 209715200),
  provider_asset_id text,
  provider_render_id text,
  provider_status text NOT NULL DEFAULT 'PENDING',
  last_polled_at timestamptz,
  poll_attempts integer NOT NULL DEFAULT 0 CHECK (poll_attempts >= 0),
  provider_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hyperframes_render_requests_job_unique UNIQUE (production_job_id),
  CONSTRAINT hyperframes_render_requests_idempotency_unique UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hyperframes_render_requests_polling
  ON public.hyperframes_render_requests (provider_status, last_polled_at)
  WHERE provider_status IN ('PENDING', 'RUNNING');

CREATE TABLE IF NOT EXISTS public.video_composition_generation_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_model text NOT NULL,
  fallback_model text,
  temperature numeric(3,2) NOT NULL DEFAULT 0.30 CHECK (temperature >= 0 AND temperature <= 2),
  automatic_generation_enabled boolean NOT NULL DEFAULT true,
  agent_assisted_generation_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.video_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hyperframes_render_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_generation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_video_compositions" ON public.video_compositions
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_compositions" ON public.video_compositions
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_compositions" ON public.video_compositions
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_revisions" ON public.video_composition_revisions
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_revisions" ON public.video_composition_revisions
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_assets" ON public.video_composition_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_assets" ON public.video_composition_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_hyperframes_render_requests" ON public.hyperframes_render_requests
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_hyperframes_render_requests" ON public.hyperframes_render_requests
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_hyperframes_render_requests" ON public.hyperframes_render_requests
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_generation_settings" ON public.video_composition_generation_settings
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_generation_settings" ON public.video_composition_generation_settings
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_generation_settings" ON public.video_composition_generation_settings
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.video_compositions IS
  'Internally-authored HyperFrames compositions. External code bundles are not supported.';
COMMENT ON COLUMN public.video_composition_revisions.manifest IS
  'Immutable JSON containing asset_manifest for repeatable 200 MiB preflight.';
COMMENT ON TABLE public.hyperframes_render_requests IS
  'HeyGen HyperFrames cloud render tracking. Completion is collected by polling, never webhooks.';
