-- Create public bucket for production videos (final edited videos)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
    'production-videos', 
    'production-videos', 
    true, -- Public bucket (videos need to be accessible via URL)
    524288000, -- 500MB limit
    ARRAY['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET 
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies for 'production-videos'

-- 1. Everyone can view production videos
CREATE POLICY "Public can view production videos" ON storage.objects
FOR SELECT
USING ( bucket_id = 'production-videos' );

-- 2. Authenticated users can upload production videos
CREATE POLICY "Authenticated users can upload production videos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK ( bucket_id = 'production-videos' );

-- 3. Authenticated users can update their own production videos
CREATE POLICY "Users can update own production videos" ON storage.objects
FOR UPDATE TO authenticated
USING ( bucket_id = 'production-videos' AND owner = auth.uid() );

-- 4. Authenticated users can delete their own production videos
CREATE POLICY "Users can delete own production videos" ON storage.objects
FOR DELETE TO authenticated
USING ( bucket_id = 'production-videos' AND owner = auth.uid() );
