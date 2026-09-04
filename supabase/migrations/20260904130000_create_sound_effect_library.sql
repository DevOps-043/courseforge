-- Organization-scoped reusable SFX library. Source binaries remain private;
-- only server-generated signed URLs may expose them to preview/render.

CREATE TABLE IF NOT EXISTS public.sound_effect_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  category text NOT NULL CHECK (category IN ('TRANSITION', 'EMPHASIS', 'UI', 'IMPACT', 'AMBIENCE', 'OTHER')),
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'READY', 'REJECTED', 'ARCHIVED')),
  storage_bucket text NOT NULL DEFAULT 'sound-effect-assets',
  storage_path text NOT NULL CHECK (storage_path !~ '(^|/)[.][.](/|$)' AND position(chr(92) in storage_path) = 0),
  mime_type text,
  file_size_bytes bigint CHECK (file_size_bytes > 0 AND file_size_bytes <= 26214400),
  duration_milliseconds bigint CHECK (duration_milliseconds > 0 AND duration_milliseconds <= 30000),
  checksum_sha256 text CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  license_type text NOT NULL DEFAULT 'INTERNAL' CHECK (char_length(license_type) <= 80),
  license_reference text CHECK (char_length(license_reference) <= 1000),
  attribution_text text CHECK (char_length(attribution_text) <= 1000),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sound_effect_assets_storage_path_unique UNIQUE (storage_bucket, storage_path),
  CONSTRAINT sound_effect_assets_checksum_unique UNIQUE NULLS NOT DISTINCT (organization_id, checksum_sha256)
);

CREATE INDEX IF NOT EXISTS idx_sound_effect_assets_ready_category
  ON public.sound_effect_assets (organization_id, category, created_at DESC)
  WHERE status = 'READY';
CREATE INDEX IF NOT EXISTS idx_sound_effect_assets_tags
  ON public.sound_effect_assets USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_sound_effect_assets_search
  ON public.sound_effect_assets USING gin (
    to_tsvector('simple'::regconfig, name || ' ' || description)
  );

CREATE TABLE IF NOT EXISTS public.video_composition_draft_sound_effect_assets (
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  sound_effect_asset_id uuid NOT NULL REFERENCES public.sound_effect_assets(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, sound_effect_asset_id)
);
CREATE INDEX IF NOT EXISTS idx_draft_sound_effect_assets_draft
  ON public.video_composition_draft_sound_effect_assets (draft_id);

CREATE TABLE IF NOT EXISTS public.video_composition_sound_effect_assets (
  composition_revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  sound_effect_asset_id uuid NOT NULL REFERENCES public.sound_effect_assets(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  source_storage_path text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (composition_revision_id, sound_effect_asset_id)
);

ALTER TABLE public.sound_effect_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_draft_sound_effect_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_sound_effect_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_sound_effect_assets" ON public.sound_effect_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_sound_effect_assets" ON public.sound_effect_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_sound_effect_assets" ON public.sound_effect_assets
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_select_draft_sound_effect_assets" ON public.video_composition_draft_sound_effect_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_draft_sound_effect_assets" ON public.video_composition_draft_sound_effect_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_select_video_composition_sound_effect_assets" ON public.video_composition_sound_effect_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_sound_effect_assets" ON public.video_composition_sound_effect_assets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sound-effect-assets', 'sound-effect-assets', false, 26214400,
  ARRAY['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "org_upload_sound_effect_assets" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'sound-effect-assets' AND name LIKE ('organizations/' || public.get_active_org_id() || '/%'));
CREATE POLICY "org_read_sound_effect_assets" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'sound-effect-assets' AND name LIKE ('organizations/' || public.get_active_org_id() || '/%'));

COMMENT ON TABLE public.sound_effect_assets IS
  'Organization-scoped, manually uploaded SFX. READY files are immutable and reusable across composition drafts.';
