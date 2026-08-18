-- Preserve source-media duration at millisecond precision for frame-aligned
-- non-destructive edits. The existing integer duration_seconds remains for
-- backward compatibility with legacy production flows.

ALTER TABLE public.production_assets
  ADD COLUMN IF NOT EXISTS duration_milliseconds bigint;

ALTER TABLE public.production_assets
  ADD CONSTRAINT production_assets_duration_milliseconds_check
  CHECK (duration_milliseconds IS NULL OR duration_milliseconds > 0);

UPDATE public.production_assets
SET duration_milliseconds = duration_seconds * 1000
WHERE duration_milliseconds IS NULL
  AND duration_seconds IS NOT NULL
  AND duration_seconds > 0;

COMMENT ON COLUMN public.production_assets.duration_milliseconds IS
  'Measured source-media duration in milliseconds. Never represents a timeline trim.';
