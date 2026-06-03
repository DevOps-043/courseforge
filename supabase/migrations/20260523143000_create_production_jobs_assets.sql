-- ============================================================================
-- Migration: Create production jobs and assets
-- Date: 2026-05-23
-- Description: Adds the initial production foundation for auditable visual/video
--   generation. B-roll prompts are the first automated asset type.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  artifact_id uuid NOT NULL,
  material_lesson_id uuid,
  material_component_id uuid,
  lesson_id text,
  module_id text,
  job_type text NOT NULL,
  provider text NOT NULL,
  provider_model text,
  status text NOT NULL DEFAULT 'PENDING',
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_request_id text,
  provider_job_id text,
  provider_callback_id text,
  provider_error jsonb,
  estimated_cost_cents integer,
  actual_cost_cents integer,
  duration_seconds integer,
  created_by uuid,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  failed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT production_jobs_status_check CHECK (
    status IN (
      'PENDING',
      'QUEUED',
      'RUNNING',
      'WAITING_PROVIDER',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'RETRY_SCHEDULED'
    )
  ),
  CONSTRAINT production_jobs_artifact_id_fkey
    FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id) ON DELETE CASCADE,
  CONSTRAINT production_jobs_material_lesson_id_fkey
    FOREIGN KEY (material_lesson_id) REFERENCES public.material_lessons(id) ON DELETE SET NULL,
  CONSTRAINT production_jobs_material_component_id_fkey
    FOREIGN KEY (material_component_id) REFERENCES public.material_components(id) ON DELETE SET NULL,
  CONSTRAINT production_jobs_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL,
  CONSTRAINT production_jobs_org_idempotency_key
    UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_production_jobs_organization_artifact
  ON public.production_jobs (organization_id, artifact_id);

CREATE INDEX IF NOT EXISTS idx_production_jobs_organization_status
  ON public.production_jobs (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_production_jobs_component_type_status
  ON public.production_jobs (material_component_id, job_type, status);

CREATE INDEX IF NOT EXISTS idx_production_jobs_provider_job_id
  ON public.production_jobs (provider, provider_job_id)
  WHERE provider_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  artifact_id uuid NOT NULL,
  production_job_id uuid,
  material_lesson_id uuid,
  material_component_id uuid,
  lesson_id text,
  module_id text,
  asset_type text NOT NULL,
  provider text,
  storage_bucket text,
  storage_path text,
  public_url text,
  external_url text,
  mime_type text,
  file_size_bytes bigint,
  duration_seconds integer,
  checksum text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  qa_status text NOT NULL DEFAULT 'PENDING',
  qa_notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_assets_pkey PRIMARY KEY (id),
  CONSTRAINT production_assets_qa_status_check CHECK (
    qa_status IN (
      'PENDING',
      'GENERATED',
      'READY_FOR_QA',
      'APPROVED',
      'REJECTED',
      'EXPORTED',
      'PUBLISHED',
      'ARCHIVED'
    )
  ),
  CONSTRAINT production_assets_artifact_id_fkey
    FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id) ON DELETE CASCADE,
  CONSTRAINT production_assets_production_job_id_fkey
    FOREIGN KEY (production_job_id) REFERENCES public.production_jobs(id) ON DELETE SET NULL,
  CONSTRAINT production_assets_material_lesson_id_fkey
    FOREIGN KEY (material_lesson_id) REFERENCES public.material_lessons(id) ON DELETE SET NULL,
  CONSTRAINT production_assets_material_component_id_fkey
    FOREIGN KEY (material_component_id) REFERENCES public.material_components(id) ON DELETE SET NULL,
  CONSTRAINT production_assets_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_production_assets_organization_artifact
  ON public.production_assets (organization_id, artifact_id);

CREATE INDEX IF NOT EXISTS idx_production_assets_component_type
  ON public.production_assets (material_component_id, asset_type);

CREATE INDEX IF NOT EXISTS idx_production_assets_job
  ON public.production_assets (production_job_id);

CREATE INDEX IF NOT EXISTS idx_production_assets_qa_status
  ON public.production_assets (organization_id, qa_status);

ALTER TABLE public.production_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_production_jobs"
  ON public.production_jobs
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_insert_production_jobs"
  ON public.production_jobs
  FOR INSERT
  WITH CHECK (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_update_production_jobs"
  ON public.production_jobs
  FOR UPDATE
  USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_select_production_assets"
  ON public.production_assets
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_insert_production_assets"
  ON public.production_assets
  FOR INSERT
  WITH CHECK (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_update_production_assets"
  ON public.production_assets
  FOR UPDATE
  USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

-- Netlify background functions use service_role, which bypasses RLS. These
-- policies protect future client/server reads that use user-scoped sessions.
