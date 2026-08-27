-- Branding media belongs to an organization, not to a course production asset.
-- Keep immutable revision provenance without weakening the existing production FK.
CREATE TABLE IF NOT EXISTS public.video_composition_brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  organization_assembly_asset_id uuid NOT NULL REFERENCES public.organization_assembly_assets(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('VIDEO')),
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  source_storage_bucket text NOT NULL,
  source_storage_path text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (composition_revision_id, organization_assembly_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_brand_assets_revision
  ON public.video_composition_brand_assets (composition_revision_id);

ALTER TABLE public.video_composition_brand_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_video_composition_brand_assets" ON public.video_composition_brand_assets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());

