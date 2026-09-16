DROP POLICY IF EXISTS "Public can upload thumbnails" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload thumbnails" ON storage.objects;

DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects;

-- Uploads and downloads for these buckets are mediated by authenticated API
-- routes using service_role or short-lived signed URLs. No broad object policy
-- is intentionally recreated here.
