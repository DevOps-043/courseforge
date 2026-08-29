-- Preserve the existing production asset policy while allowing the font formats
-- accepted by the organization slide-font API. A NULL list means unrestricted
-- MIME types, so it must remain unchanged.
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT mime_type ORDER BY mime_type)
  FROM unnest(
    allowed_mime_types || ARRAY[
      'font/woff2',
      'font/woff',
      'font/ttf',
      'font/otf',
      'application/font-woff',
      'application/x-font-ttf'
    ]::text[]
  ) AS mime_type
)
WHERE id = 'production-assets'
  AND allowed_mime_types IS NOT NULL;
