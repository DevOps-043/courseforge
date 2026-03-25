-- ============================================================================
-- Migration: Add organization-aware RLS to child tables
-- Date: 2026-03-25
-- Description: Enables RLS on tables that inherit org context via artifact FK.
--   Child tables (syllabus, curation, materials, etc.) don't have their own
--   organization_id column — they reference artifacts.organization_id via FK.
--   These policies use a subquery to verify org ownership through the artifact.
-- ============================================================================

-- Helper function to extract active_organization_id from JWT claims
CREATE OR REPLACE FUNCTION public.get_active_org_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      current_setting('request.jwt.claims', true)::json->>'active_organization_id',
      current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id'
    );
  $$;

-- ============================================================================
-- 1. SYLLABUS — references artifacts.id via artifact_id
-- ============================================================================

ALTER TABLE public.syllabus ENABLE ROW LEVEL SECURITY;

-- Drop existing permissive policies if any
DROP POLICY IF EXISTS "Enable read access for all users" ON public.syllabus;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.syllabus;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.syllabus;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.syllabus;

CREATE POLICY "org_select_syllabus" ON public.syllabus
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = syllabus.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_syllabus" ON public.syllabus
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = syllabus.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_syllabus" ON public.syllabus
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = syllabus.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_delete_syllabus" ON public.syllabus
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = syllabus.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 2. INSTRUCTIONAL_PLANS — references artifacts.id via artifact_id
-- ============================================================================

-- RLS already enabled, drop old permissive policies
DROP POLICY IF EXISTS "Enable read access for all users" ON public.instructional_plans;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.instructional_plans;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.instructional_plans;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.instructional_plans;

CREATE POLICY "org_select_instructional_plans" ON public.instructional_plans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = instructional_plans.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_instructional_plans" ON public.instructional_plans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = instructional_plans.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_instructional_plans" ON public.instructional_plans
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = instructional_plans.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_delete_instructional_plans" ON public.instructional_plans
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = instructional_plans.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 3. CURATION — references artifacts.id via artifact_id
-- ============================================================================

ALTER TABLE public.curation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.curation;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.curation;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.curation;
DROP POLICY IF EXISTS "Enable delete access for all users" ON public.curation;

CREATE POLICY "org_select_curation" ON public.curation
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = curation.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_curation" ON public.curation
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = curation.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_curation" ON public.curation
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = curation.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 4. CURATION_ROWS — references curation.id via curation_id → artifacts
-- ============================================================================

ALTER TABLE public.curation_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_curation_rows" ON public.curation_rows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.curation c
      JOIN public.artifacts a ON a.id = c.artifact_id
      WHERE c.id = curation_rows.curation_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_curation_rows" ON public.curation_rows
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.curation c
      JOIN public.artifacts a ON a.id = c.artifact_id
      WHERE c.id = curation_rows.curation_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_curation_rows" ON public.curation_rows
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.curation c
      JOIN public.artifacts a ON a.id = c.artifact_id
      WHERE c.id = curation_rows.curation_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 5. MATERIALS — references artifacts.id via artifact_id
-- ============================================================================

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_materials" ON public.materials
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = materials.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_materials" ON public.materials
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = materials.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_materials" ON public.materials
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = materials.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 6. MATERIAL_LESSONS — references materials.id via materials_id
-- ============================================================================

ALTER TABLE public.material_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_material_lessons" ON public.material_lessons
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      JOIN public.artifacts a ON a.id = m.artifact_id
      WHERE m.id = material_lessons.materials_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_material_lessons" ON public.material_lessons
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.materials m
      JOIN public.artifacts a ON a.id = m.artifact_id
      WHERE m.id = material_lessons.materials_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_material_lessons" ON public.material_lessons
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      JOIN public.artifacts a ON a.id = m.artifact_id
      WHERE m.id = material_lessons.materials_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 7. MATERIAL_COMPONENTS — references material_lessons.id via material_lesson_id
-- ============================================================================

ALTER TABLE public.material_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_material_components" ON public.material_components
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.material_lessons ml
      JOIN public.materials m ON m.id = ml.materials_id
      JOIN public.artifacts a ON a.id = m.artifact_id
      WHERE ml.id = material_components.material_lesson_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_material_components" ON public.material_components
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.material_lessons ml
      JOIN public.materials m ON m.id = ml.materials_id
      JOIN public.artifacts a ON a.id = m.artifact_id
      WHERE ml.id = material_components.material_lesson_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_material_components" ON public.material_components
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.material_lessons ml
      JOIN public.materials m ON m.id = ml.materials_id
      JOIN public.artifacts a ON a.id = m.artifact_id
      WHERE ml.id = material_components.material_lesson_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- 8. PUBLICATION_REQUESTS — references artifacts.id via artifact_id
-- ============================================================================

ALTER TABLE public.publication_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_publication_requests" ON public.publication_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = publication_requests.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_insert_publication_requests" ON public.publication_requests
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = publication_requests.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

CREATE POLICY "org_update_publication_requests" ON public.publication_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.id = publication_requests.artifact_id
        AND (a.organization_id IS NULL OR a.organization_id::text = public.get_active_org_id())
    )
  );

-- ============================================================================
-- SERVICE ROLE BYPASS: Netlify background functions use service_role key,
-- which bypasses RLS entirely. No changes needed for background jobs.
-- ============================================================================
