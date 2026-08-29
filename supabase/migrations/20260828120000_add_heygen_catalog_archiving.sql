-- Non-destructive catalog cleanup. Provider resources remain in HeyGen and can
-- be restored locally; synchronization intentionally preserves this flag.
ALTER TABLE public.heygen_avatar_presets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.heygen_voice_presets
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS heygen_avatar_presets_org_archived_idx
  ON public.heygen_avatar_presets (organization_id, archived_at);

CREATE INDEX IF NOT EXISTS heygen_voice_presets_org_archived_idx
  ON public.heygen_voice_presets (organization_id, archived_at);

COMMENT ON COLUMN public.heygen_avatar_presets.archived_at IS
  'When set, hides the provider preset from generation without deleting it in HeyGen.';

COMMENT ON COLUMN public.heygen_voice_presets.archived_at IS
  'When set, hides the provider preset from generation without deleting it in HeyGen.';
