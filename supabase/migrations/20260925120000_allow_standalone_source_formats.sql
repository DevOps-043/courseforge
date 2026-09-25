-- Add formats accepted by the standalone importer without broadening public access.
-- Originals remain private; HTML is sanitized before entering a composition.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT mime_type
  FROM unnest(allowed_mime_types || ARRAY['image/png', 'image/jpeg', 'text/html']::text[]) AS mime_type
  ORDER BY mime_type
)
WHERE id = 'production-render-sources'
  AND allowed_mime_types IS NOT NULL;
