-- Durable orchestration metadata for SCORM parsing and transformation jobs.
-- Additive only: existing imports remain valid and can be processed by the new workers.

ALTER TABLE public.scorm_imports
  ADD COLUMN IF NOT EXISTS processing_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scorm_imports_processing_attempt_nonnegative'
      AND conrelid = 'public.scorm_imports'::regclass
  ) THEN
    ALTER TABLE public.scorm_imports
      ADD CONSTRAINT scorm_imports_processing_attempt_nonnegative
      CHECK (processing_attempt >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_scorm_imports_active_lease
  ON public.scorm_imports (organization_id, status, lease_expires_at)
  WHERE status IN ('SCORM_PARSING', 'SCORM_TRANSFORMING');

CREATE OR REPLACE FUNCTION public.claim_scorm_import_job(
  p_import_id uuid,
  p_organization_id uuid,
  p_status text,
  p_queued_step text,
  p_running_step text,
  p_lease_seconds integer DEFAULT 900
)
RETURNS SETOF public.scorm_imports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'SCORM lease must be between 30 and 3600 seconds';
  END IF;

  RETURN QUERY
  UPDATE public.scorm_imports AS target
  SET processing_attempt = target.processing_attempt + 1,
      processing_step = p_running_step,
      processing_started_at = v_now,
      processing_heartbeat_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
  WHERE target.id = p_import_id
    AND target.organization_id = p_organization_id
    AND target.status = p_status
    AND (
      target.processing_step = p_queued_step
      OR (
        target.processing_step = p_running_step
        AND target.lease_expires_at IS NOT NULL
        AND target.lease_expires_at <= v_now
      )
    )
  RETURNING target.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_scorm_import_job(
  p_import_id uuid,
  p_organization_id uuid,
  p_status text,
  p_running_step text,
  p_lease_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_updated integer;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'SCORM lease must be between 30 and 3600 seconds';
  END IF;

  UPDATE public.scorm_imports AS target
  SET processing_heartbeat_at = v_now,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
  WHERE target.id = p_import_id
    AND target.organization_id = p_organization_id
    AND target.status = p_status
    AND target.processing_step = p_running_step;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_scorm_import_artifact(
  p_import_id uuid,
  p_organization_id uuid,
  p_title text,
  p_description text,
  p_target_audience text,
  p_objectives jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_artifact_id uuid;
  v_created_by uuid;
BEGIN
  SELECT artifact_id, created_by
  INTO v_artifact_id, v_created_by
  FROM public.scorm_imports
  WHERE id = p_import_id
    AND organization_id = p_organization_id
    AND status = 'SCORM_TRANSFORMING'
    AND processing_step = 'TRANSFORM_RUNNING'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCORM import is not owned by the transformation worker';
  END IF;
  IF v_artifact_id IS NOT NULL THEN
    RETURN v_artifact_id;
  END IF;
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'SCORM import creator is missing';
  END IF;

  INSERT INTO public.artifacts (
    idea_central,
    nombres,
    objetivos,
    descripcion,
    state,
    created_by,
    organization_id
  ) VALUES (
    COALESCE(NULLIF(btrim(p_description), ''), NULLIF(btrim(p_title), ''), 'Curso SCORM importado'),
    jsonb_build_array(COALESCE(NULLIF(btrim(p_title), ''), 'Curso SCORM importado')),
    COALESCE(p_objectives, '[]'::jsonb),
    jsonb_build_object(
      'text', COALESCE(NULLIF(btrim(p_description), ''), 'Curso SCORM importado'),
      'target_audience', COALESCE(NULLIF(btrim(p_target_audience), ''), 'General')
    ),
    'DRAFT',
    v_created_by,
    p_organization_id
  )
  RETURNING id INTO v_artifact_id;

  UPDATE public.scorm_imports
  SET artifact_id = v_artifact_id,
      updated_at = clock_timestamp()
  WHERE id = p_import_id
    AND organization_id = p_organization_id;

  RETURN v_artifact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_scorm_material_projection(
  p_import_id uuid,
  p_organization_id uuid,
  p_materials_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.scorm_imports AS source_import
    JOIN public.materials AS source_materials
      ON source_materials.artifact_id = source_import.artifact_id
    WHERE source_import.id = p_import_id
      AND source_import.organization_id = p_organization_id
      AND source_import.status = 'SCORM_TRANSFORMING'
      AND source_import.processing_step = 'TRANSFORM_RUNNING'
      AND source_materials.id = p_materials_id
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.material_components
  WHERE material_lesson_id IN (
    SELECT id FROM public.material_lessons WHERE materials_id = p_materials_id
  );
  DELETE FROM public.material_lessons WHERE materials_id = p_materials_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scorm_import_job(uuid, uuid, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_scorm_import_job(uuid, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_scorm_import_artifact(uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_scorm_material_projection(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scorm_import_job(uuid, uuid, text, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_scorm_import_job(uuid, uuid, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_scorm_import_artifact(uuid, uuid, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_scorm_material_projection(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.claim_scorm_import_job(uuid, uuid, text, text, text, integer)
  IS 'Atomically claims a queued SCORM phase or reclaims it after its lease expires.';
COMMENT ON FUNCTION public.heartbeat_scorm_import_job(uuid, uuid, text, text, integer)
  IS 'Extends the lease of the worker currently processing a SCORM phase.';
