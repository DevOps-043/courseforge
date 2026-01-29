-- Create public bucket for course thumbnails
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
    'thumbnails', 
    'thumbnails', 
    true, -- Public bucket
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET 
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies for 'thumbnails'

-- 1. Everyone can view thumbnails
CREATE POLICY "Public can view thumbnails" ON storage.objects
FOR SELECT
USING ( bucket_id = 'thumbnails' );

-- 2. Authenticated users can upload thumbnails
CREATE POLICY "Authenticated users can upload thumbnails" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK ( bucket_id = 'thumbnails' );

-- 3. Users can update/delete their own thumbnails
CREATE POLICY "Users can update own thumbnails" ON storage.objects
FOR UPDATE TO authenticated
USING ( bucket_id = 'thumbnails' AND owner = auth.uid() );

CREATE POLICY "Users can delete own thumbnails" ON storage.objects
FOR DELETE TO authenticated
USING ( bucket_id = 'thumbnails' AND owner = auth.uid() );
