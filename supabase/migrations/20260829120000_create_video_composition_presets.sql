-- Dynamic, organization-scoped composition presets and non-destructive previews.
-- A preview stores both the exact base and proposed documents. Apply/undo only
-- append new editor versions; source assets and immutable render snapshots are untouched.

CREATE TABLE IF NOT EXISTS public.video_composition_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  source_kind text NOT NULL CHECK (source_kind IN ('INSTRUCTIONS', 'MANUAL')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_composition_presets_org_status
  ON public.video_composition_presets (organization_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.video_composition_preset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id uuid NOT NULL REFERENCES public.video_composition_presets(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  definition jsonb NOT NULL,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  source_document_hash text CHECK (source_document_hash IS NULL OR source_document_hash ~ '^[a-f0-9]{64}$'),
  instruction text CHECK (instruction IS NULL OR length(instruction) BETWEEN 3 AND 1500),
  extraction_diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_preset_versions_unique_version UNIQUE (preset_id, version)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_preset_versions_preset
  ON public.video_composition_preset_versions (preset_id, version DESC);

CREATE TABLE IF NOT EXISTS public.video_composition_preset_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  preset_ref text NOT NULL CHECK (length(preset_ref) BETWEEN 1 AND 160),
  preset_version_id uuid REFERENCES public.video_composition_preset_versions(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  base_document jsonb NOT NULL,
  base_document_hash text NOT NULL CHECK (base_document_hash ~ '^[a-f0-9]{64}$'),
  proposed_document jsonb NOT NULL,
  proposed_document_hash text NOT NULL CHECK (proposed_document_hash ~ '^[a-f0-9]{64}$'),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPLIED', 'DISMISSED', 'EXPIRED', 'UNDONE')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  applied_version integer CHECK (applied_version > 0),
  applied_at timestamptz,
  undone_version integer CHECK (undone_version > 0),
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_preset_applications_apply_state CHECK (
    (status IN ('APPLIED', 'UNDONE') AND applied_version IS NOT NULL AND applied_at IS NOT NULL)
    OR (status NOT IN ('APPLIED', 'UNDONE') AND applied_version IS NULL AND applied_at IS NULL)
  ),
  CONSTRAINT video_composition_preset_applications_undo_state CHECK (
    (status = 'UNDONE' AND undone_version IS NOT NULL AND undone_at IS NOT NULL)
    OR (status <> 'UNDONE' AND undone_version IS NULL AND undone_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_video_composition_preset_applications_draft
  ON public.video_composition_preset_applications (draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_composition_preset_applications_pending_expiry
  ON public.video_composition_preset_applications (expires_at)
  WHERE status = 'PENDING';

ALTER TABLE public.video_composition_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_preset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_composition_preset_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_video_composition_presets" ON public.video_composition_presets
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_presets" ON public.video_composition_presets
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_presets" ON public.video_composition_presets
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_preset_versions" ON public.video_composition_preset_versions
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_preset_versions" ON public.video_composition_preset_versions
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_select_video_composition_preset_applications" ON public.video_composition_preset_applications
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_preset_applications" ON public.video_composition_preset_applications
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_update_video_composition_preset_applications" ON public.video_composition_preset_applications
  FOR UPDATE USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE OR REPLACE FUNCTION public.create_video_composition_preset(
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_source_kind text,
  p_definition jsonb,
  p_definition_hash text,
  p_schema_version integer,
  p_source_document_hash text,
  p_instruction text,
  p_extraction_diagnostics jsonb,
  p_actor_id uuid
)
RETURNS TABLE(preset_id uuid, preset_version_id uuid, version integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_preset_id uuid;
  v_version_id uuid;
BEGIN
  IF p_source_kind NOT IN ('INSTRUCTIONS', 'MANUAL')
    OR length(trim(p_name)) NOT BETWEEN 3 AND 120
    OR length(coalesce(p_description, '')) > 500
    OR p_definition_hash !~ '^[a-f0-9]{64}$'
    OR p_schema_version < 1 THEN
    RAISE EXCEPTION 'Invalid composition preset data' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.video_composition_presets (
    organization_id, name, description, source_kind, created_by
  ) VALUES (
    p_organization_id, trim(p_name), coalesce(p_description, ''), p_source_kind, p_actor_id
  ) RETURNING id INTO v_preset_id;

  INSERT INTO public.video_composition_preset_versions (
    preset_id, organization_id, version, schema_version, definition,
    definition_hash, source_document_hash, instruction,
    extraction_diagnostics, created_by
  ) VALUES (
    v_preset_id, p_organization_id, 1, p_schema_version, p_definition,
    p_definition_hash, p_source_document_hash, p_instruction,
    coalesce(p_extraction_diagnostics, '[]'::jsonb), p_actor_id
  ) RETURNING id INTO v_version_id;

  RETURN QUERY SELECT v_preset_id, v_version_id, 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_video_composition_preset_application(
  p_application_id uuid,
  p_draft_id uuid,
  p_organization_id uuid,
  p_expected_document_hash text,
  p_actor_id uuid
)
RETURNS TABLE(outcome text, version integer, document_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_application public.video_composition_preset_applications%ROWTYPE;
  v_current_hash text;
  v_current_version integer;
  v_next_version integer;
BEGIN
  SELECT * INTO v_application
  FROM public.video_composition_preset_applications
  WHERE id = p_application_id AND draft_id = p_draft_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::integer, NULL::text; RETURN; END IF;
  IF v_application.status = 'APPLIED' THEN
    RETURN QUERY SELECT 'ALREADY_APPLIED'::text, v_application.applied_version, v_application.proposed_document_hash; RETURN;
  END IF;
  IF v_application.status = 'UNDONE' THEN
    RETURN QUERY SELECT 'ALREADY_UNDONE'::text, v_application.undone_version, v_application.base_document_hash; RETURN;
  END IF;
  IF v_application.status <> 'PENDING' THEN RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::integer, NULL::text; RETURN; END IF;
  IF v_application.expires_at <= now() THEN
    UPDATE public.video_composition_preset_applications SET status = 'EXPIRED', updated_at = now() WHERE id = p_application_id;
    RETURN QUERY SELECT 'EXPIRED'::text, NULL::integer, NULL::text; RETURN;
  END IF;
  IF v_application.base_document_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'CONFLICT'::text, NULL::integer, v_application.base_document_hash; RETURN;
  END IF;

  BEGIN
    PERFORM 1 FROM public.video_composition_drafts
    WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN QUERY SELECT 'BUSY'::text, NULL::integer, NULL::text; RETURN;
  END;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_EDITABLE'::text, NULL::integer, NULL::text; RETURN; END IF;

  SELECT d.document_hash, d.version INTO v_current_hash, v_current_version
  FROM public.video_composition_draft_documents d
  WHERE d.draft_id = p_draft_id AND d.organization_id = p_organization_id
  ORDER BY d.version DESC LIMIT 1;
  IF NOT FOUND OR v_current_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'CONFLICT'::text, v_current_version, v_current_hash; RETURN;
  END IF;

  v_next_version := v_current_version + 1;
  INSERT INTO public.video_composition_draft_documents (
    draft_id, organization_id, version, format, document, document_hash, created_by
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version,
    v_application.proposed_document ->> 'format', v_application.proposed_document,
    v_application.proposed_document_hash, p_actor_id
  );
  INSERT INTO public.video_composition_draft_changes (
    draft_id, organization_id, version, actor_id, source, summary, metadata
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_actor_id, 'USER',
    'Aplicó el preset de composición.',
    jsonb_build_object('presetApplicationId', p_application_id, 'presetRef', v_application.preset_ref)
  );
  UPDATE public.video_composition_drafts
  SET current_version = v_next_version, last_changed_by = p_actor_id, updated_at = now()
  WHERE id = p_draft_id AND organization_id = p_organization_id;
  UPDATE public.video_composition_preset_applications
  SET status = 'APPLIED', applied_version = v_next_version, applied_at = now(), updated_at = now()
  WHERE id = p_application_id;

  RETURN QUERY SELECT 'APPLIED'::text, v_next_version, v_application.proposed_document_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_video_composition_preset_application(
  p_application_id uuid,
  p_draft_id uuid,
  p_organization_id uuid,
  p_expected_document_hash text,
  p_actor_id uuid
)
RETURNS TABLE(outcome text, version integer, document_hash text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_application public.video_composition_preset_applications%ROWTYPE;
  v_current_hash text;
  v_current_version integer;
  v_next_version integer;
BEGIN
  SELECT * INTO v_application
  FROM public.video_composition_preset_applications
  WHERE id = p_application_id AND draft_id = p_draft_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::integer, NULL::text; RETURN; END IF;
  IF v_application.status = 'UNDONE' THEN
    RETURN QUERY SELECT 'ALREADY_UNDONE'::text, v_application.undone_version, v_application.base_document_hash; RETURN;
  END IF;
  IF v_application.status <> 'APPLIED' OR v_application.proposed_document_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'UNDO_CONFLICT'::text, v_application.applied_version, v_application.proposed_document_hash; RETURN;
  END IF;

  BEGIN
    PERFORM 1 FROM public.video_composition_drafts
    WHERE id = p_draft_id AND organization_id = p_organization_id AND state = 'ACTIVE'
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN QUERY SELECT 'BUSY'::text, NULL::integer, NULL::text; RETURN;
  END;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_EDITABLE'::text, NULL::integer, NULL::text; RETURN; END IF;

  SELECT d.document_hash, d.version INTO v_current_hash, v_current_version
  FROM public.video_composition_draft_documents d
  WHERE d.draft_id = p_draft_id AND d.organization_id = p_organization_id
  ORDER BY d.version DESC LIMIT 1;
  IF NOT FOUND OR v_current_hash <> p_expected_document_hash THEN
    RETURN QUERY SELECT 'UNDO_CONFLICT'::text, v_current_version, v_current_hash; RETURN;
  END IF;

  v_next_version := v_current_version + 1;
  INSERT INTO public.video_composition_draft_documents (
    draft_id, organization_id, version, format, document, document_hash, created_by
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version,
    v_application.base_document ->> 'format', v_application.base_document,
    v_application.base_document_hash, p_actor_id
  );
  INSERT INTO public.video_composition_draft_changes (
    draft_id, organization_id, version, actor_id, source, summary, metadata
  ) VALUES (
    p_draft_id, p_organization_id, v_next_version, p_actor_id, 'USER',
    'Revirtió el preset de composición.',
    jsonb_build_object('presetApplicationId', p_application_id, 'presetRef', v_application.preset_ref, 'undo', true)
  );
  UPDATE public.video_composition_drafts
  SET current_version = v_next_version, last_changed_by = p_actor_id, updated_at = now()
  WHERE id = p_draft_id AND organization_id = p_organization_id;
  UPDATE public.video_composition_preset_applications
  SET status = 'UNDONE', undone_version = v_next_version, undone_at = now(), updated_at = now()
  WHERE id = p_application_id;

  RETURN QUERY SELECT 'UNDONE'::text, v_next_version, v_application.base_document_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.create_video_composition_preset(uuid, text, text, text, jsonb, text, integer, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_video_composition_preset(uuid, text, text, text, jsonb, text, integer, text, text, jsonb, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.apply_video_composition_preset_application(uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_video_composition_preset_application(uuid, uuid, uuid, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.undo_video_composition_preset_application(uuid, uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_video_composition_preset_application(uuid, uuid, uuid, text, uuid) TO service_role;

COMMENT ON TABLE public.video_composition_presets IS
  'Reusable organization-scoped native editor patterns. System presets live in code and are not duplicated per tenant.';
COMMENT ON TABLE public.video_composition_preset_applications IS
  'Expiring, non-destructive preset previews with exact append-only apply and undo semantics.';

