-- Adds tenant ownership to SCORM imports so uploaded packages cannot be
-- processed across organizations before an artifact exists.

ALTER TABLE public.scorm_imports
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scorm_imports_organization_id
  ON public.scorm_imports (organization_id);

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.scorm_imports;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.scorm_imports;
DROP POLICY IF EXISTS "Enable update access for creators" ON public.scorm_imports;

CREATE POLICY "org_select_scorm_imports" ON public.scorm_imports
  FOR SELECT USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_insert_scorm_imports" ON public.scorm_imports
  FOR INSERT WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_update_scorm_imports" ON public.scorm_imports
  FOR UPDATE USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
  )
  WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_select_scorm_resources" ON public.scorm_resources
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.scorm_imports si
      WHERE si.id = scorm_resources.scorm_import_id
        AND (si.organization_id IS NULL OR si.organization_id::text = public.get_active_org_id())
    )
  );
