-- ============================================================================
-- Migration: Create Remotion Templates and Acquired Templates tables
-- Date: 2026-06-06
-- Description: Adds dynamic templates system with multi-tenant ownership
--   and cross-organization sharing (acquisition) support.
-- ============================================================================

-- 1. Create remotion_templates table
CREATE TABLE IF NOT EXISTS public.remotion_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  entry_point text NOT NULL DEFAULT 'index.tsx',
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  storage_path text,
  thumbnail_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT remotion_templates_pkey PRIMARY KEY (id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_remotion_templates_org 
  ON public.remotion_templates (organization_id);

CREATE INDEX IF NOT EXISTS idx_remotion_templates_public 
  ON public.remotion_templates (is_public);

-- 2. Create organization_acquired_templates junction table
CREATE TABLE IF NOT EXISTS public.organization_acquired_templates (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.remotion_templates(id) ON DELETE CASCADE,
  acquired_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_acquired_templates_pkey PRIMARY KEY (organization_id, template_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_acquired_templates_org 
  ON public.organization_acquired_templates (organization_id);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.remotion_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_acquired_templates ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for remotion_templates
CREATE POLICY "select_remotion_templates" ON public.remotion_templates
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id::text = public.get_active_org_id()
    OR is_public = true
  );

CREATE POLICY "insert_remotion_templates" ON public.remotion_templates
  FOR INSERT
  WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "update_remotion_templates" ON public.remotion_templates
  FOR UPDATE
  USING (
    organization_id::text = public.get_active_org_id()
  )
  WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "delete_remotion_templates" ON public.remotion_templates
  FOR DELETE
  USING (
    organization_id::text = public.get_active_org_id()
  );

-- 5. RLS Policies for organization_acquired_templates
CREATE POLICY "select_acquired_templates" ON public.organization_acquired_templates
  FOR SELECT
  USING (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "insert_acquired_templates" ON public.organization_acquired_templates
  FOR INSERT
  WITH CHECK (
    organization_id::text = public.get_active_org_id()
  );

CREATE POLICY "delete_acquired_templates" ON public.organization_acquired_templates
  FOR DELETE
  USING (
    organization_id::text = public.get_active_org_id()
  );

-- 6. Seed initial classic system/global templates
INSERT INTO public.remotion_templates (id, organization_id, name, description, entry_point, is_public, thumbnail_url)
VALUES 
  ('8ef33d3c-9a48-433b-82a1-bd12822a105c', NULL, 'Presentación + Avatar (Dividida)', 'Muestra las slides de Open Design al lado izquierdo y al avatar en la esquina derecha.', 'src/index.tsx', true, '🎨'),
  ('a2c3dbf9-2e02-4757-bbdf-a2c6d48c8dfa', NULL, 'Presentación Completa (Diapositivas)', 'Prioriza las diapositivas a pantalla completa con voz y música de fondo.', 'src/index.tsx', true, '📊'),
  ('cb2657e3-0d32-4d1a-bf41-86f21272de3b', NULL, 'Avatar Enfocado (Talking Head)', 'El avatar de Heygen ocupa el centro de la pantalla con soporte inferior de slides.', 'src/index.tsx', true, '👤')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  entry_point = EXCLUDED.entry_point,
  is_public = EXCLUDED.is_public,
  thumbnail_url = EXCLUDED.thumbnail_url;
