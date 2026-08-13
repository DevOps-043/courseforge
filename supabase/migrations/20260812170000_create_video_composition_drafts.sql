-- Editable project state for the visual video studio.
-- A draft can change repeatedly; a render revision remains immutable.
-- This migration is additive and does not alter any legacy render data.

CREATE TABLE IF NOT EXISTS public.video_composition_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id uuid NOT NULL UNIQUE REFERENCES public.video_compositions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'ACTIVE',
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  project_storage_bucket text NOT NULL DEFAULT 'production-assets',
  project_storage_prefix text NOT NULL,
  source_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_drafts_state_check CHECK (state IN ('ACTIVE', 'LOCKED', 'ARCHIVED')),
  CONSTRAINT video_composition_drafts_safe_prefix_check
    CHECK (
      project_storage_prefix <> ''
      AND position(chr(92) in project_storage_prefix) = 0
      AND project_storage_prefix !~ '(^|/)[.][.](/|$)'
    )
);

CREATE INDEX IF NOT EXISTS idx_video_composition_drafts_org_state
  ON public.video_composition_drafts (organization_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.video_composition_draft_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  content_type text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes >= 0),
  content_version text NOT NULL CHECK (content_version ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_draft_files_safe_relative_path_check
    CHECK (
      relative_path <> ''
      AND position(chr(92) in relative_path) = 0
      AND relative_path !~ '(^|/)[.][.](/|$)'
    ),
  CONSTRAINT video_composition_draft_files_unique_path UNIQUE (draft_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_draft_files_draft
  ON public.video_composition_draft_files (draft_id, relative_path);

CREATE TABLE IF NOT EXISTS public.video_composition_draft_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  production_asset_id uuid NOT NULL REFERENCES public.production_assets(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  source_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_draft_assets_unique_asset UNIQUE (draft_id, production_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_draft_assets_draft
  ON public.video_composition_draft_assets (draft_id);

CREATE TABLE IF NOT EXISTS public.video_composition_draft_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('USER', 'AGENT', 'SYSTEM')),
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_draft_changes_unique_version UNIQUE (draft_id, version)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_draft_changes_draft
  ON public.video_composition_draft_changes (draft_id, version DESC);

ALTER TABLE public.video_composition_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_draft_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_draft_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_draft_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_video_composition_drafts" ON public.video_composition_drafts
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_drafts" ON public.video_composition_drafts
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_drafts" ON public.video_composition_drafts
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_draft_files" ON public.video_composition_draft_files
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_draft_files" ON public.video_composition_draft_files
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_draft_files" ON public.video_composition_draft_files
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_draft_assets" ON public.video_composition_draft_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_draft_assets" ON public.video_composition_draft_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_draft_changes" ON public.video_composition_draft_changes
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_draft_changes" ON public.video_composition_draft_changes
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.video_composition_drafts IS
  'Mutable source project used by the visual video editor; never submitted directly to cloud rendering.';
COMMENT ON TABLE public.video_composition_draft_files IS
  'Versioned editable project files. Media remains referenced through production assets.';
COMMENT ON TABLE public.video_composition_draft_changes IS
  'Audit trail for user, agent and system draft mutations.';
