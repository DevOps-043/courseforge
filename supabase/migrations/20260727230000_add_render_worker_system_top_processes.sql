-- ============================================================================
-- Render worker telemetry: global process attribution
-- ============================================================================

ALTER TABLE public.render_worker_job_metric_samples
  ADD COLUMN IF NOT EXISTS system_top_processes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.render_worker_job_metric_samples.system_top_processes IS
  'Top system-wide processes by sampled CPU/memory, used to attribute render bottlenecks outside the worker process tree.';
