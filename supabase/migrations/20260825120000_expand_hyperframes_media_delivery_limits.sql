-- HyperFrames projects now deliver source media by immutable public Storage URL.
-- The ZIP remains capped at 200 MiB; only source and final-video objects expand.

UPDATE storage.buckets
SET file_size_limit = 2147483648
WHERE id IN ('production-assets', 'production-videos')
  AND COALESCE(file_size_limit, 0) < 2147483648;

ALTER TABLE private.hyperframes_render_imports
  DROP CONSTRAINT IF EXISTS hyperframes_render_imports_size_check;

ALTER TABLE private.hyperframes_render_imports
  ADD CONSTRAINT hyperframes_render_imports_size_check
  CHECK (
    source_size_bytes IS NULL
    OR (source_size_bytes > 0 AND source_size_bytes <= 2147483648)
  );

COMMENT ON CONSTRAINT hyperframes_render_imports_size_check
  ON private.hyperframes_render_imports IS
  'Allows resumable imports up to 2 GiB without buffering the complete video in an Edge Function.';
