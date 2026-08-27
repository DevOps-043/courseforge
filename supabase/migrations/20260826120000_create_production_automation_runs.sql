-- Durable, asset-first automation for production phase 6.
--
-- A run only plans and tracks the generation of source assets. It never
-- submits a HyperFrames render: that remains an explicit editor action.

CREATE TABLE IF NOT EXISTS public.production_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'PLANNING',
  configuration jsonb NOT NULL DEFAULT '{"approval_state":"DRAFT","render_mode":"MANUAL_ONLY","version":1}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_runs_status_check CHECK (status IN (
    'PLANNING', 'GENERATING', 'PARTIALLY_READY', 'READY_FOR_ASSEMBLY',
    'NEEDS_ATTENTION', 'CANCELLED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_production_runs_org_artifact_created
  ON public.production_runs (organization_id, artifact_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS production_runs_one_active_per_artifact_uidx
  ON public.production_runs (organization_id, artifact_id)
  WHERE status IN ('PLANNING', 'GENERATING', 'PARTIALLY_READY', 'NEEDS_ATTENTION');

CREATE TABLE IF NOT EXISTS public.production_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_run_id uuid NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  module_id text,
  module_order integer NOT NULL,
  lesson_order integer NOT NULL,
  material_lesson_id uuid NOT NULL REFERENCES public.material_lessons(id) ON DELETE CASCADE,
  material_component_id uuid NOT NULL REFERENCES public.material_components(id) ON DELETE CASCADE,
  component_type text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED',
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error jsonb,
  dispatch_attempts integer NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  ready_for_assembly_at timestamptz,
  editor_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_run_items_status_check CHECK (status IN (
    'PLANNED', 'QUEUED', 'GENERATING', 'WAITING_PROVIDER',
    'READY_FOR_ASSEMBLY', 'IN_ASSEMBLY', 'STALE', 'FAILED_RETRYABLE',
    'FAILED', 'SKIPPED'
  )),
  CONSTRAINT production_run_items_module_order_check CHECK (module_order >= 0),
  CONSTRAINT production_run_items_lesson_order_check CHECK (lesson_order >= 0),
  CONSTRAINT production_run_items_dispatch_attempts_check CHECK (dispatch_attempts >= 0),
  CONSTRAINT production_run_items_run_component_unique UNIQUE (production_run_id, material_component_id)
);

CREATE INDEX IF NOT EXISTS idx_production_run_items_dispatch
  ON public.production_run_items (production_run_id, module_order, lesson_order)
  WHERE status IN ('PLANNED', 'QUEUED', 'FAILED_RETRYABLE');

CREATE INDEX IF NOT EXISTS idx_production_run_items_component
  ON public.production_run_items (material_component_id, updated_at DESC);

ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_production_runs"
  ON public.production_runs FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_production_run_items"
  ON public.production_run_items FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

-- Creation, dispatch and state transitions are backend-owned. The service role
-- bypasses RLS, while clients can observe their organisation's progress.
