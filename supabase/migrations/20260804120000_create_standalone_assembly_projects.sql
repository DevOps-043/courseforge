-- Standalone assembly projects keep the admin assembly studio independent from
-- course pipeline navigation while preserving compatibility with the current
-- renderer contract, which still resolves assets through a material component.

CREATE TABLE IF NOT EXISTS public.standalone_assembly_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'DRAFT'::text CHECK (
    status = ANY (
      ARRAY[
        'DRAFT'::text,
        'READY'::text,
        'RENDERING'::text,
        'COMPLETED'::text,
        'FAILED'::text,
        'ARCHIVED'::text
      ]
    )
  ),
  final_video_url text NULL,
  backing_artifact_id uuid NULL REFERENCES public.artifacts(id) ON DELETE SET NULL,
  backing_material_id uuid NULL REFERENCES public.materials(id) ON DELETE SET NULL,
  backing_lesson_id uuid NULL REFERENCES public.material_lessons(id) ON DELETE SET NULL,
  backing_component_id uuid NULL REFERENCES public.material_components(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT standalone_assembly_projects_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_standalone_assembly_projects_org_updated
  ON public.standalone_assembly_projects (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_standalone_assembly_projects_created_by
  ON public.standalone_assembly_projects (created_by);

CREATE UNIQUE INDEX IF NOT EXISTS idx_standalone_assembly_projects_component
  ON public.standalone_assembly_projects (backing_component_id)
  WHERE backing_component_id IS NOT NULL;

ALTER TABLE public.standalone_assembly_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_select_standalone_assembly_projects" ON public.standalone_assembly_projects;
DROP POLICY IF EXISTS "org_insert_standalone_assembly_projects" ON public.standalone_assembly_projects;
DROP POLICY IF EXISTS "org_update_standalone_assembly_projects" ON public.standalone_assembly_projects;
DROP POLICY IF EXISTS "org_delete_standalone_assembly_projects" ON public.standalone_assembly_projects;

CREATE POLICY "org_select_standalone_assembly_projects" ON public.standalone_assembly_projects
  FOR SELECT USING (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_insert_standalone_assembly_projects" ON public.standalone_assembly_projects
  FOR INSERT WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_update_standalone_assembly_projects" ON public.standalone_assembly_projects
  FOR UPDATE USING (
    organization_id::text = public.get_active_org_id()
  )
  WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "org_delete_standalone_assembly_projects" ON public.standalone_assembly_projects
  FOR DELETE USING (
    organization_id::text = public.get_active_org_id()
  );
