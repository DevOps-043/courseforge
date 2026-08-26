-- HyperFrames keeps legacy public assets compatible while new sensitive/large
-- sources can use a private bucket and just-in-time signed delivery.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'production-render-sources',
  'production-render-sources',
  false,
  2147483648,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

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
