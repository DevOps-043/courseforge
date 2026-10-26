-- Autoría por curso: agregado acotado a 24 sesiones; escrituras CAS breves.
-- Contenido privado y configuración reconstructible: acceso solo por backend autorizado.
BEGIN;
CREATE TABLE public.course_delivery_workspaces (
  artifact_id uuid PRIMARY KEY REFERENCES public.artifacts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 8388608),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX course_delivery_workspaces_org_idx ON public.course_delivery_workspaces(organization_id);
CREATE TABLE public.course_delivery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES public.course_delivery_workspaces(artifact_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('AGENDA','PLAN','MATERIALS')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','PAUSED','FAILED','COMPLETED','CANCELLED')),
  expected_revision integer NOT NULL,
  snapshot jsonb NOT NULL CHECK (octet_length(snapshot::text) <= 8388608),
  units jsonb NOT NULL CHECK (jsonb_typeof(units) = 'array' AND jsonb_array_length(units) BETWEEN 1 AND 24),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX course_delivery_one_active_run ON public.course_delivery_runs(artifact_id)
  WHERE status IN ('QUEUED','RUNNING','PAUSED','FAILED');
CREATE INDEX course_delivery_runs_history_idx ON public.course_delivery_runs(artifact_id,created_at DESC);
ALTER TABLE public.course_delivery_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_delivery_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_delivery_workspaces, public.course_delivery_runs FROM anon, authenticated;
GRANT ALL ON public.course_delivery_workspaces, public.course_delivery_runs TO service_role;

CREATE TABLE public.course_delivery_versions (
  artifact_id uuid NOT NULL REFERENCES public.course_delivery_workspaces(artifact_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  document jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(artifact_id,revision)
);
ALTER TABLE public.course_delivery_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_delivery_versions FROM anon,authenticated;
GRANT SELECT,INSERT ON public.course_delivery_versions TO service_role;
CREATE FUNCTION public.preserve_course_delivery_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.course_delivery_versions(artifact_id,organization_id,revision,document)
    VALUES(OLD.artifact_id,OLD.organization_id,OLD.revision,OLD.document) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- Las políticas históricas de settings no conceden edición directa de estas
-- capacidades: pasan siempre por las acciones administrativas autorizadas.
CREATE POLICY course_delivery_models_backend_only ON public.model_settings AS RESTRICTIVE
  FOR ALL TO anon,authenticated
  USING (setting_type NOT IN ('SYNCHRONOUS_AGENDA','SYNCHRONOUS_PLAN','SYNCHRONOUS_MATERIALS'))
  WITH CHECK (setting_type NOT IN ('SYNCHRONOUS_AGENDA','SYNCHRONOUS_PLAN','SYNCHRONOUS_MATERIALS'));
CREATE POLICY course_delivery_prompts_backend_only ON public.system_prompts AS RESTRICTIVE
  FOR ALL TO anon,authenticated
  USING (code NOT IN ('SYNCHRONOUS_AGENDA','SYNCHRONOUS_PLAN','SYNCHRONOUS_MATERIALS'))
  WITH CHECK (code NOT IN ('SYNCHRONOUS_AGENDA','SYNCHRONOUS_PLAN','SYNCHRONOUS_MATERIALS'));
REVOKE ALL ON FUNCTION public.preserve_course_delivery_version() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_course_delivery_version BEFORE UPDATE ON public.course_delivery_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.preserve_course_delivery_version();

CREATE FUNCTION public.save_course_delivery(
  p_artifact_id uuid, p_organization_id uuid, p_revision integer, p_document jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE current_row public.course_delivery_workspaces; next_revision integer;
BEGIN
  -- La relación curso/organización también se comprueba en DB antes de persistir.
  PERFORM 1 FROM public.artifacts WHERE id=p_artifact_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_NOT_FOUND'; END IF;
  SELECT * INTO current_row FROM public.course_delivery_workspaces WHERE artifact_id=p_artifact_id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_revision <> 0 THEN RAISE EXCEPTION 'DELIVERY_REVISION_CONFLICT'; END IF;
    INSERT INTO public.course_delivery_workspaces(artifact_id,organization_id,revision,document)
      VALUES(p_artifact_id,p_organization_id,1,p_document);
    RETURN 1;
  END IF;
  IF current_row.organization_id <> p_organization_id OR current_row.revision <> p_revision THEN
    RAISE EXCEPTION 'DELIVERY_REVISION_CONFLICT';
  END IF;
  next_revision := current_row.revision+1;
  UPDATE public.course_delivery_workspaces SET document=p_document,revision=next_revision,updated_at=now()
    WHERE artifact_id=p_artifact_id;
  UPDATE public.course_delivery_runs SET status='CANCELLED',lease_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE artifact_id=p_artifact_id AND status IN ('QUEUED','RUNNING','PAUSED','FAILED');
  RETURN next_revision;
END $$;

CREATE FUNCTION public.reserve_course_delivery_run(
  p_artifact_id uuid,p_organization_id uuid,p_revision integer,p_operation text,p_snapshot jsonb,p_units jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_row public.course_delivery_workspaces; run_id uuid;
BEGIN
  SELECT * INTO current_row FROM public.course_delivery_workspaces WHERE artifact_id=p_artifact_id FOR UPDATE;
  IF NOT FOUND OR current_row.organization_id<>p_organization_id THEN RAISE EXCEPTION 'DELIVERY_NOT_FOUND'; END IF;
  IF current_row.revision<>p_revision THEN RAISE EXCEPTION 'DELIVERY_REVISION_CONFLICT'; END IF;
  INSERT INTO public.course_delivery_runs(artifact_id,organization_id,expected_revision,operation,snapshot,units)
    VALUES(p_artifact_id,p_organization_id,p_revision,p_operation,p_snapshot,p_units) RETURNING id INTO run_id;
  RETURN run_id;
END $$;

CREATE FUNCTION public.claim_course_delivery_run(p_run_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.course_delivery_runs SET status='RUNNING',lease_token=p_token,
    lease_expires_at=now()+interval '12 minutes',updated_at=now()
    WHERE id=p_run_id AND status='QUEUED';
  RETURN FOUND;
END $$;

CREATE FUNCTION public.commit_course_delivery_unit(
  p_run_id uuid,p_token uuid,p_document jsonb,p_units jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE run_row public.course_delivery_runs; current_row public.course_delivery_workspaces;
BEGIN
  -- Orden de locks común: workspace antes de run, también en edición/aprobación.
  SELECT * INTO current_row FROM public.course_delivery_workspaces
    WHERE artifact_id=(SELECT artifact_id FROM public.course_delivery_runs WHERE id=p_run_id) FOR UPDATE;
  SELECT * INTO run_row FROM public.course_delivery_runs WHERE id=p_run_id FOR UPDATE;
  IF run_row.id IS NULL OR run_row.status<>'RUNNING' OR run_row.lease_token IS DISTINCT FROM p_token
    OR run_row.lease_expires_at<now() OR current_row.revision<>run_row.expected_revision
    OR current_row.organization_id<>run_row.organization_id THEN
    RAISE EXCEPTION 'DELIVERY_STALE_RUN';
  END IF;
  UPDATE public.course_delivery_workspaces SET document=p_document,revision=revision+1,updated_at=now()
    WHERE artifact_id=run_row.artifact_id;
  UPDATE public.course_delivery_runs SET expected_revision=expected_revision+1,units=p_units,updated_at=now()
    WHERE id=p_run_id;
  RETURN current_row.revision+1;
END $$;

CREATE FUNCTION public.approve_course_delivery(
  p_artifact_id uuid,p_organization_id uuid,p_revision integer,p_document jsonb,
  p_syllabus jsonb,p_nexus jsonb,p_materials jsonb,p_sources jsonb,p_phase text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_row public.course_delivery_workspaces; actual_syllabus jsonb; actual_nexus jsonb; actual_materials jsonb; actual_sources jsonb; nexus_state text;
BEGIN
  SELECT * INTO current_row FROM public.course_delivery_workspaces WHERE artifact_id=p_artifact_id FOR UPDATE;
  IF NOT FOUND OR current_row.organization_id<>p_organization_id OR current_row.revision<>p_revision THEN
    RAISE EXCEPTION 'DELIVERY_REVISION_CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM public.course_delivery_runs WHERE artifact_id=p_artifact_id AND status IN ('QUEUED','RUNNING','PAUSED','FAILED')) THEN
    RAISE EXCEPTION 'DELIVERY_GENERATION_ACTIVE';
  END IF;
  SELECT modules INTO actual_syllabus FROM public.syllabus WHERE artifact_id=p_artifact_id AND state='STEP_APPROVED' FOR UPDATE;
  IF actual_syllabus IS DISTINCT FROM p_syllabus THEN RAISE EXCEPTION 'DELIVERY_SYLLABUS_CHANGED'; END IF;
  SELECT lesson_plans,state INTO actual_nexus,nexus_state FROM public.instructional_plans WHERE artifact_id=p_artifact_id FOR UPDATE;
  IF actual_nexus IS DISTINCT FROM p_nexus THEN RAISE EXCEPTION 'DELIVERY_NEXUS_CHANGED'; END IF;
  SELECT to_jsonb(m) INTO actual_materials FROM public.materials m WHERE artifact_id=p_artifact_id FOR UPDATE;
  IF actual_materials IS DISTINCT FROM p_materials THEN RAISE EXCEPTION 'DELIVERY_MATERIALS_CHANGED'; END IF;
  PERFORM 1 FROM public.curation WHERE artifact_id=p_artifact_id FOR UPDATE;
  PERFORM 1 FROM public.curation_rows WHERE curation_id IN (SELECT id FROM public.curation WHERE artifact_id=p_artifact_id) FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO actual_sources
    FROM public.curation_rows r WHERE curation_id IN (SELECT id FROM public.curation WHERE artifact_id=p_artifact_id);
  IF actual_sources IS DISTINCT FROM p_sources THEN RAISE EXCEPTION 'DELIVERY_SOURCES_CHANGED'; END IF;
  IF p_phase NOT IN ('PLAN','MATERIALS') THEN RAISE EXCEPTION 'DELIVERY_INVALID_PHASE'; END IF;
  IF p_phase='MATERIALS' AND NOT EXISTS (SELECT 1 FROM public.curation WHERE artifact_id=p_artifact_id AND state='PHASE2_APPROVED') THEN
    RAISE EXCEPTION 'DELIVERY_CURATION_APPROVAL_REQUIRED';
  END IF;
  IF current_row.document->'config'->>'mode'='HYBRID' AND p_phase='MATERIALS'
    AND (actual_materials IS NULL OR actual_materials->>'state'<>'PHASE3_APPROVED') THEN
    RAISE EXCEPTION 'DELIVERY_NEXUS_MATERIALS_APPROVAL_REQUIRED';
  END IF;
  IF current_row.document->'config'->>'mode'='HYBRID' AND p_phase='PLAN' THEN
    IF jsonb_array_length(coalesce(actual_nexus,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'DELIVERY_NEXUS_REQUIRED'; END IF;
    -- La aprobación Nexus pertenece a su acción autorizada y conserva sus controles QA.
    IF nexus_state<>'STEP_APPROVED' THEN RAISE EXCEPTION 'DELIVERY_NEXUS_APPROVAL_REQUIRED'; END IF;
  END IF;
  UPDATE public.course_delivery_workspaces SET document=p_document,revision=revision+1,updated_at=now()
    WHERE artifact_id=p_artifact_id;
  RETURN current_row.revision+1;
END $$;

REVOKE ALL ON FUNCTION public.save_course_delivery(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_course_delivery_run(uuid,uuid,integer,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_course_delivery_run(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commit_course_delivery_unit(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_course_delivery(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_course_delivery(uuid,uuid,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_course_delivery_run(uuid,uuid,integer,text,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_course_delivery_run(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_course_delivery_unit(uuid,uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_course_delivery(uuid,uuid,integer,jsonb,jsonb,jsonb,jsonb,jsonb,text) TO service_role;

CREATE FUNCTION public.save_course_delivery_setting(
  p_organization_id uuid,p_user_id uuid,p_setting_type text,p_model jsonb,p_prompt text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE next_version text;
BEGIN
  IF p_setting_type NOT IN ('SYNCHRONOUS_AGENDA','SYNCHRONOUS_PLAN','SYNCHRONOUS_MATERIALS')
    OR length(trim(p_prompt)) NOT BETWEEN 1 AND 40000 THEN RAISE EXCEPTION 'DELIVERY_INVALID_SETTING'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_setting_type,0));
  UPDATE public.model_settings SET is_active=false WHERE organization_id=p_organization_id AND setting_type=p_setting_type AND is_active=true;
  IF p_model IS NOT NULL AND p_model<>'null'::jsonb THEN
    INSERT INTO public.model_settings(organization_id,setting_type,scope,is_active,model_name,fallback_model,temperature,thinking_level)
      VALUES(p_organization_id,p_setting_type,'Cursos',true,p_model->>'model_name',p_model->>'fallback_model',
        (p_model->>'temperature')::numeric,p_model->>'thinking_level');
  END IF;
  SELECT '1.0.'||count(*)::text INTO next_version FROM public.system_prompts WHERE organization_id=p_organization_id AND code=p_setting_type;
  UPDATE public.system_prompts SET is_active=false WHERE organization_id=p_organization_id AND code=p_setting_type AND is_active=true;
  INSERT INTO public.system_prompts(organization_id,code,scope,version,content,description,is_active,created_by,source)
    VALUES(p_organization_id,p_setting_type,'Cursos',next_version,p_prompt,'Generación sincrónica configurable',true,p_user_id,'MANUAL');
END $$;
REVOKE ALL ON FUNCTION public.save_course_delivery_setting(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_course_delivery_setting(uuid,uuid,text,jsonb,text) TO service_role;

-- Conservar el allowlist previo y añadir únicamente estas capacidades.
DO $$
DECLARE previous_expression text;
BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO previous_expression FROM pg_constraint
    WHERE conrelid='public.model_settings'::regclass AND conname='model_settings_setting_type_check';
  IF previous_expression IS NOT NULL THEN
    ALTER TABLE public.model_settings DROP CONSTRAINT model_settings_setting_type_check;
    EXECUTE 'ALTER TABLE public.model_settings ADD CONSTRAINT model_settings_setting_type_check CHECK (('
      ||previous_expression||') OR setting_type IN (''SYNCHRONOUS_AGENDA'',''SYNCHRONOUS_PLAN'',''SYNCHRONOUS_MATERIALS'')) NOT VALID';
  END IF;
END $$;
COMMIT;
