-- Reinforce tenant and immutable-source invariants for reusable SFX.
-- Apply before deploying code that reads source_storage_bucket from revision links.

ALTER TABLE public.video_composition_drafts
  ADD CONSTRAINT video_composition_drafts_id_org_unique
  UNIQUE (id, organization_id);

ALTER TABLE public.video_composition_revisions
  ADD CONSTRAINT video_composition_revisions_id_org_unique
  UNIQUE (id, organization_id);

ALTER TABLE public.sound_effect_assets
  ADD CONSTRAINT sound_effect_assets_id_org_unique
  UNIQUE (id, organization_id);

ALTER TABLE public.video_composition_draft_sound_effect_assets
  ADD CONSTRAINT draft_sound_effect_assets_draft_org_fkey
  FOREIGN KEY (draft_id, organization_id)
  REFERENCES public.video_composition_drafts (id, organization_id)
  ON DELETE CASCADE
  NOT VALID,
  ADD CONSTRAINT draft_sound_effect_assets_asset_org_fkey
  FOREIGN KEY (sound_effect_asset_id, organization_id)
  REFERENCES public.sound_effect_assets (id, organization_id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.video_composition_draft_sound_effect_assets
  VALIDATE CONSTRAINT draft_sound_effect_assets_draft_org_fkey;
ALTER TABLE public.video_composition_draft_sound_effect_assets
  VALIDATE CONSTRAINT draft_sound_effect_assets_asset_org_fkey;

ALTER TABLE public.video_composition_sound_effect_assets
  ADD COLUMN source_storage_bucket text;

UPDATE public.video_composition_sound_effect_assets AS revision_asset
SET source_storage_bucket = source_asset.storage_bucket
FROM public.sound_effect_assets AS source_asset
WHERE source_asset.id = revision_asset.sound_effect_asset_id
  AND source_asset.organization_id = revision_asset.organization_id
  AND revision_asset.source_storage_bucket IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.video_composition_sound_effect_assets
    WHERE source_storage_bucket IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot harden SFX revisions: one or more rows have no tenant-matching source asset';
  END IF;
END
$$;

ALTER TABLE public.video_composition_sound_effect_assets
  ALTER COLUMN source_storage_bucket SET NOT NULL,
  ADD CONSTRAINT composition_sound_effect_assets_revision_org_fkey
  FOREIGN KEY (composition_revision_id, organization_id)
  REFERENCES public.video_composition_revisions (id, organization_id)
  ON DELETE CASCADE
  NOT VALID,
  ADD CONSTRAINT composition_sound_effect_assets_asset_org_fkey
  FOREIGN KEY (sound_effect_asset_id, organization_id)
  REFERENCES public.sound_effect_assets (id, organization_id)
  ON DELETE RESTRICT
  NOT VALID,
  ADD CONSTRAINT composition_sound_effect_assets_storage_identity_check
  CHECK (
    source_storage_bucket <> ''
    AND source_storage_path <> ''
    AND source_storage_path !~ '(^|/)[.][.](/|$)'
    AND position(chr(92) in source_storage_path) = 0
  );

ALTER TABLE public.video_composition_sound_effect_assets
  VALIDATE CONSTRAINT composition_sound_effect_assets_revision_org_fkey;
ALTER TABLE public.video_composition_sound_effect_assets
  VALIDATE CONSTRAINT composition_sound_effect_assets_asset_org_fkey;

CREATE OR REPLACE FUNCTION public.prevent_ready_sound_effect_binary_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status IN ('READY', 'ARCHIVED')
    AND ROW(
      NEW.storage_bucket,
      NEW.storage_path,
      NEW.mime_type,
      NEW.file_size_bytes,
      NEW.duration_milliseconds,
      NEW.checksum_sha256
    ) IS DISTINCT FROM ROW(
      OLD.storage_bucket,
      OLD.storage_path,
      OLD.mime_type,
      OLD.file_size_bytes,
      OLD.duration_milliseconds,
      OLD.checksum_sha256
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'A READY or ARCHIVED sound effect binary identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_prevent_ready_sound_effect_binary_mutation
  ON public.sound_effect_assets;
CREATE TRIGGER trg_prevent_ready_sound_effect_binary_mutation
BEFORE UPDATE ON public.sound_effect_assets
FOR EACH ROW
EXECUTE FUNCTION public.prevent_ready_sound_effect_binary_mutation();

COMMENT ON COLUMN public.video_composition_sound_effect_assets.source_storage_bucket IS
  'Immutable source bucket frozen with the SFX revision identity; never a signed URL.';
