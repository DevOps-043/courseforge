CREATE TABLE IF NOT EXISTS public.render_worker_job_recovery_states (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL,
  organization_id uuid NOT NULL,
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
  local_state text NOT NULL,
  artifact_ready boolean NOT NULL DEFAULT false,
  artifact_checksum text,
  artifact_size_bytes bigint,
  cleanup_policy text,
  cleanup_status text,
  last_reported_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT render_worker_job_recovery_states_pkey PRIMARY KEY (id),
  CONSTRAINT render_worker_job_recovery_states_worker_fkey
    FOREIGN KEY (worker_id) REFERENCES public.render_workers(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_recovery_states_organization_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT render_worker_job_recovery_states_unique_job
    UNIQUE (worker_id, remote_table, remote_job_id)
);

CREATE INDEX IF NOT EXISTS idx_render_worker_job_recovery_org_state
  ON public.render_worker_job_recovery_states (organization_id, local_state);

CREATE INDEX IF NOT EXISTS idx_render_worker_job_recovery_worker_cleanup
  ON public.render_worker_job_recovery_states (worker_id, cleanup_status);
