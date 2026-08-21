-- Include the post-upload/pre-render checkpoint in operational polling indexes.
-- This migration is separate because the initial concurrency migration may
-- already be applied in production.
DROP INDEX IF EXISTS public.idx_hyperframes_render_requests_polling;
CREATE INDEX idx_hyperframes_render_requests_polling
  ON public.hyperframes_render_requests (provider_status, last_polled_at)
  WHERE provider_status IN ('UPLOADING', 'SUBMITTING', 'PENDING', 'RUNNING');
