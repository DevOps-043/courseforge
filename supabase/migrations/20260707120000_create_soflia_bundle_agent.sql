-- ============================================================================
-- Migration: Create SofLIA bundle agent audit model
-- Date: 2026-07-07
-- Description:
--   Stores tenant-scoped conversations, specs, generation runs and links to
--   Remotion template versions created by the SofLIA Bundle Agent. Generated
--   bundles still flow through remotion_template_versions and cloud builds.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.soflia_bundle_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.remotion_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'DRAFTING',
  title text NOT NULL DEFAULT 'SofLIA Remotion bundle',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT soflia_bundle_conversations_pkey PRIMARY KEY (id),
  CONSTRAINT soflia_bundle_conversations_status_check CHECK (
    status IN (
      'DRAFTING',
      'READY_FOR_GENERATION',
      'GENERATING',
      'VERSION_PENDING_REVIEW',
      'ACTIVE',
      'ARCHIVED',
      'FAILED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_conversations_org_status
  ON public.soflia_bundle_conversations (organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_conversations_template
  ON public.soflia_bundle_conversations (template_id)
  WHERE template_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_soflia_bundle_template_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.template_id IS NOT NULL
     AND NEW.template_id IS DISTINCT FROM OLD.template_id THEN
    RAISE EXCEPTION 'SofLIA bundle conversation template_id cannot be reassigned';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_soflia_bundle_template_reassignment_trigger
  ON public.soflia_bundle_conversations;

CREATE TRIGGER prevent_soflia_bundle_template_reassignment_trigger
  BEFORE UPDATE OF template_id ON public.soflia_bundle_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_soflia_bundle_template_reassignment();

CREATE TABLE IF NOT EXISTS public.soflia_bundle_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.soflia_bundle_conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content_redacted text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT soflia_bundle_messages_pkey PRIMARY KEY (id),
  CONSTRAINT soflia_bundle_messages_role_check CHECK (
    role IN ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL')
  )
);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_messages_conversation
  ON public.soflia_bundle_messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.soflia_bundle_specs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.soflia_bundle_conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  spec_json jsonb NOT NULL,
  spec_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT soflia_bundle_specs_pkey PRIMARY KEY (id),
  CONSTRAINT soflia_bundle_specs_version_unique UNIQUE (conversation_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_specs_conversation
  ON public.soflia_bundle_specs (conversation_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_specs_hash
  ON public.soflia_bundle_specs (spec_hash);

CREATE TABLE IF NOT EXISTS public.soflia_bundle_generation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.soflia_bundle_conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  spec_id uuid REFERENCES public.soflia_bundle_specs(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.remotion_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  model text,
  input_hash text,
  output_hash text,
  bundle_storage_path text,
  validation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_sanitized text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  CONSTRAINT soflia_bundle_generation_runs_pkey PRIMARY KEY (id),
  CONSTRAINT soflia_bundle_generation_runs_status_check CHECK (
    status IN (
      'QUEUED',
      'RUNNING',
      'PACKAGED',
      'VALIDATION_FAILED',
      'SUBMITTED_FOR_REVIEW',
      'FAILED'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_generation_runs_conversation
  ON public.soflia_bundle_generation_runs (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_generation_runs_org_status
  ON public.soflia_bundle_generation_runs (organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.soflia_bundle_version_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.soflia_bundle_conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  generation_run_id uuid NOT NULL REFERENCES public.soflia_bundle_generation_runs(id) ON DELETE CASCADE,
  template_version_id uuid NOT NULL REFERENCES public.remotion_template_versions(id) ON DELETE CASCADE,
  parent_template_version_id uuid REFERENCES public.remotion_template_versions(id) ON DELETE SET NULL,
  change_summary text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT soflia_bundle_version_links_pkey PRIMARY KEY (id),
  CONSTRAINT soflia_bundle_version_links_version_unique UNIQUE (template_version_id)
);

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_version_links_conversation
  ON public.soflia_bundle_version_links (conversation_id, created_at DESC);

ALTER TABLE public.soflia_bundle_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soflia_bundle_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soflia_bundle_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soflia_bundle_generation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soflia_bundle_version_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_soflia_bundle_conversations"
  ON public.soflia_bundle_conversations
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_soflia_bundle_conversations"
  ON public.soflia_bundle_conversations
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "update_soflia_bundle_conversations"
  ON public.soflia_bundle_conversations
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "select_soflia_bundle_messages"
  ON public.soflia_bundle_messages
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_soflia_bundle_messages"
  ON public.soflia_bundle_messages
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "select_soflia_bundle_specs"
  ON public.soflia_bundle_specs
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_soflia_bundle_specs"
  ON public.soflia_bundle_specs
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "select_soflia_bundle_generation_runs"
  ON public.soflia_bundle_generation_runs
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_soflia_bundle_generation_runs"
  ON public.soflia_bundle_generation_runs
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "update_soflia_bundle_generation_runs"
  ON public.soflia_bundle_generation_runs
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "select_soflia_bundle_version_links"
  ON public.soflia_bundle_version_links
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "insert_soflia_bundle_version_links"
  ON public.soflia_bundle_version_links
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.soflia_bundle_conversations IS
  'Tenant-scoped SofLIA Bundle Agent conversations. A conversation may own one primary Remotion template.';

COMMENT ON TABLE public.soflia_bundle_generation_runs IS
  'Auditable non-runtime generation attempts. A successful run only submits a Remotion template version for review.';
