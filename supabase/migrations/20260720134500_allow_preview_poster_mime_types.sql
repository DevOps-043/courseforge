-- Allow fast Remotion preview posters to live beside public production artifacts.
-- The bucket was originally restricted to video MIME types, which makes Supabase
-- reject preview poster uploads (image/png) with HTTP 400.
UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT ARRAY(
    SELECT DISTINCT mime_type
    FROM unnest(
      allowed_mime_types || ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
    ) AS mime_type
    ORDER BY mime_type
  )
)
WHERE id = 'production-videos'
  AND allowed_mime_types IS NOT NULL;
