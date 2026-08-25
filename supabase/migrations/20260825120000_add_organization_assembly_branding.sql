-- Reusable intro/outro media is tenant-owned branding, not course production.
-- It therefore intentionally does not reference artifacts or material components.

CREATE TABLE IF NOT EXISTS public.organization_assembly_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('INTRO', 'OUTRO')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes >= 0),
  duration_milliseconds integer NOT NULL CHECK (duration_milliseconds > 0),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'ARCHIVED', 'REJECTED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_assembly_assets_safe_storage_path CHECK (
    storage_path <> ''
    AND position(chr(92) in storage_path) = 0
    AND storage_path !~ '(^|/)[.][.](/|$)'
  )
);

CREATE INDEX IF NOT EXISTS idx_organization_assembly_assets_org_kind_status
  ON public.organization_assembly_assets (organization_id, kind, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.organization_assembly_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  default_intro_asset_id uuid REFERENCES public.organization_assembly_assets(id) ON DELETE SET NULL,
  default_outro_asset_id uuid REFERENCES public.organization_assembly_assets(id) ON DELETE SET NULL,
  intro_enabled boolean NOT NULL DEFAULT true,
  outro_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.video_composition_draft_branding (
  draft_id uuid PRIMARY KEY REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  intro_asset_id uuid REFERENCES public.organization_assembly_assets(id) ON DELETE SET NULL,
  outro_asset_id uuid REFERENCES public.organization_assembly_assets(id) ON DELETE SET NULL,
  intro_source text NOT NULL DEFAULT 'ORG_DEFAULT' CHECK (intro_source IN ('ORG_DEFAULT', 'ASSEMBLY_OVERRIDE', 'GENERATED')),
  intro_snapshot jsonb,
  outro_snapshot jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_composition_draft_branding_org
  ON public.video_composition_draft_branding (organization_id);

ALTER TABLE public.organization_assembly_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_assembly_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_draft_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_organization_assembly_assets" ON public.organization_assembly_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_organization_assembly_assets" ON public.organization_assembly_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_organization_assembly_assets" ON public.organization_assembly_assets
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_organization_assembly_settings" ON public.organization_assembly_settings
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_organization_assembly_settings" ON public.organization_assembly_settings
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_organization_assembly_settings" ON public.organization_assembly_settings
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_draft_branding" ON public.video_composition_draft_branding
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_draft_branding" ON public.video_composition_draft_branding
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_draft_branding" ON public.video_composition_draft_branding
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
