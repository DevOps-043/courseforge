-- ============================================================================
-- Migration: Render worker job telemetry
-- Date: 2026-07-25
-- Description: Persists desktop worker runtime/resource telemetry per claimed job.
--   Desktop workers never write to Supabase directly; authenticated backend
--   endpoints resolve worker_id and organization_id from the worker token.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.render_worker_job_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  local_run_id text NOT NULL,
  remote_table text NOT NULL CHECK (remote_table = ANY (ARRAY[
    'production_jobs'::text,
    'remotion_template_builds'::text,
    'remotion_template_previews'::text
  ])),
  remote_job_id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type = ANY (ARRAY[
    'render'::text,
    'template_build'::text,
    'template_preview'::text
  ])),
  production_job_id uuid,
  template_build_id uuid,
  template_preview_id uuid,
  related_template_build_id uuid,
  render_batch_id uuid,
  artifact_id uuid,
  material_component_id uuid,
  template_version_id uuid,
  composition_id text,
  bundle_hash text,
  props_hash text,
  output_storage_path text,
  status text NOT NULL DEFAULT 'running' CHECK (status = ANY (ARRAY[
    'running'::text,
    'completed'::text,
    'upload_pending'::text,
    'confirm_pending'::text,
    'failed'::text,
    'interrupted'::text
  ])),
  started_at timestamp with time zone NOT NULL,
  finished_at timestamp with time zone,
  elapsed_ms bigint,
  last_stage text,
  last_progress_percent numeric(5,2),
  power_profile text,
  max_concurrent_jobs integer,
  render_concurrency integer,
  hardware_acceleration text,
  chromium_gl text,
  video_bitrate text,
  platform text NOT NULL,
  arch text NOT NULL,
  cpu_model text,
  cpu_logical_threads integer NOT NULL CHECK (cpu_logical_threads >= 1),
  memory_total_bytes bigint NOT NULL CHECK (memory_total_bytes >= 0),
  gpu_adapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  hardware_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_count integer NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  avg_app_cpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  max_app_cpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  avg_app_gpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  max_app_gpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  avg_app_memory_bytes bigint NOT NULL DEFAULT 0,
  max_app_memory_bytes bigint NOT NULL DEFAULT 0,
  avg_system_cpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  max_system_cpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  avg_system_gpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  max_system_gpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  max_system_memory_used_bytes bigint NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT render_worker_job_runs_pkey PRIMARY KEY (id),
  CONSTRAINT render_worker_job_runs_worker_fkey
    FOREIGN KEY (worker_id) REFERENCES public.render_workers(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_runs_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_runs_production_job_fkey
    FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_runs_template_build_fkey
    FOREIGN KEY (template_build_id) REFERENCES public.remotion_template_builds(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_runs_template_preview_fkey
    FOREIGN KEY (template_preview_id) REFERENCES public.remotion_template_previews(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_runs_related_template_build_fkey
    FOREIGN KEY (related_template_build_id) REFERENCES public.remotion_template_builds(id) ON DELETE SET NULL,
  CONSTRAINT render_worker_job_runs_render_batch_fkey
    FOREIGN KEY (render_batch_id) REFERENCES public.production_render_batches(id) ON DELETE SET NULL,
  CONSTRAINT render_worker_job_runs_artifact_fkey
    FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id) ON DELETE SET NULL,
  CONSTRAINT render_worker_job_runs_material_component_fkey
    FOREIGN KEY (material_component_id) REFERENCES public.material_components(id) ON DELETE SET NULL,
  CONSTRAINT render_worker_job_runs_template_version_fkey
    FOREIGN KEY (template_version_id) REFERENCES public.remotion_template_versions(id) ON DELETE SET NULL,
  CONSTRAINT render_worker_job_runs_unique_local_run
    UNIQUE (worker_id, local_run_id),
  CONSTRAINT render_worker_job_runs_remote_ref_matches_table CHECK (
    (
      remote_table = 'production_jobs'
      AND production_job_id = remote_job_id
      AND template_build_id IS NULL
      AND template_preview_id IS NULL
    )
    OR (
      remote_table = 'remotion_template_builds'
      AND template_build_id = remote_job_id
      AND production_job_id IS NULL
      AND template_preview_id IS NULL
    )
    OR (
      remote_table = 'remotion_template_previews'
      AND template_preview_id = remote_job_id
      AND production_job_id IS NULL
      AND template_build_id IS NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.render_worker_job_metric_samples (
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  run_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  remote_table text NOT NULL,
  remote_job_id uuid NOT NULL,
  sampled_at timestamp with time zone NOT NULL,
  worker_state text NOT NULL,
  stage text,
  progress_percent numeric(5,2),
  app_cpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  app_gpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  app_memory_bytes bigint NOT NULL DEFAULT 0,
  app_process_count integer NOT NULL DEFAULT 0,
  system_cpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  system_gpu_percent numeric(6,2) NOT NULL DEFAULT 0,
  system_memory_used_bytes bigint NOT NULL DEFAULT 0,
  system_memory_total_bytes bigint NOT NULL DEFAULT 0,
  system_cpu_count integer NOT NULL DEFAULT 0,
  top_processes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT render_worker_job_metric_samples_pkey PRIMARY KEY (id),
  CONSTRAINT render_worker_job_metric_samples_run_fkey
    FOREIGN KEY (run_id) REFERENCES public.render_worker_job_runs(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_metric_samples_worker_fkey
    FOREIGN KEY (worker_id) REFERENCES public.render_workers(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_metric_samples_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_metric_samples_unique_sample
    UNIQUE (run_id, sampled_at)
);

CREATE INDEX IF NOT EXISTS idx_render_worker_job_runs_org_remote_started
  ON public.render_worker_job_runs (organization_id, remote_table, remote_job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_render_worker_job_runs_worker_status_started
  ON public.render_worker_job_runs (worker_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_render_worker_job_runs_component_started
  ON public.render_worker_job_runs (organization_id, material_component_id, started_at DESC)
  WHERE material_component_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_render_worker_job_runs_batch_started
  ON public.render_worker_job_runs (render_batch_id, started_at DESC)
  WHERE render_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_render_worker_job_metric_samples_run_sampled
  ON public.render_worker_job_metric_samples (run_id, sampled_at);

CREATE INDEX IF NOT EXISTS idx_render_worker_job_metric_samples_org_remote_sampled
  ON public.render_worker_job_metric_samples (organization_id, remote_table, remote_job_id, sampled_at DESC);

ALTER TABLE public.render_worker_job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_worker_job_metric_samples ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.render_worker_job_runs IS
  'Per-job desktop worker telemetry run summaries written by server-side worker endpoints.';

COMMENT ON TABLE public.render_worker_job_metric_samples IS
  'Time-series resource samples for desktop worker job runs. Payloads are minimized and exclude tokens, signed URLs, props and local paths.';
