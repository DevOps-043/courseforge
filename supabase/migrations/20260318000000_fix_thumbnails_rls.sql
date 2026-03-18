-- Fix RLS policy for thumbnails bucket to allow uploads without a valid Supabase Auth session
-- (Because the app uses a custom JWT signed for CourseForge, the storage client acts as anon)

DROP POLICY IF EXISTS "Authenticated users can upload thumbnails" ON storage.objects;

-- Allow anyone to upload thumbnails (since they are just 5MB images and we don't have Supabase Auth context in the storage client)
CREATE POLICY "Public can upload thumbnails" ON storage.objects
FOR INSERT TO public
WITH CHECK ( bucket_id = 'thumbnails' );
