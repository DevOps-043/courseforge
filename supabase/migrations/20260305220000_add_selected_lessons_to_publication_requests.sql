-- Add selected_lessons column to publication_requests
-- Stores an array of lesson IDs that the user has selected for publishing
-- Default: NULL (means "all lessons with video" for backward compatibility)
ALTER TABLE public.publication_requests
ADD COLUMN selected_lessons jsonb DEFAULT NULL;

-- Add a comment for documentation
COMMENT ON COLUMN public.publication_requests.selected_lessons IS 'Array of lesson_id strings selected for publishing. NULL = all lessons with video (backward compat).';
