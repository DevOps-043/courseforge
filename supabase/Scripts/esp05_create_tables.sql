-- =====================================================
-- ESP-05: Tablas de Generación de Materiales
-- Ejecutar en Supabase SQL Editor en este orden
-- =====================================================

-- 1. Tabla principal de materiales
create table if not exists public.materials (
  id uuid not null default gen_random_uuid (),
  artifact_id uuid not null,
  version integer not null default 1,
  prompt_version text not null default 'default'::text,
  state text not null default 'PHASE3_DRAFT'::text,
  qa_decision jsonb null,
  package jsonb null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  lessons jsonb null default '[]'::jsonb,
  global_blockers jsonb null default '[]'::jsonb,
  dod jsonb null default '{"checklist": [], "automatic_checks": []}'::jsonb,
  constraint materials_pkey primary key (id),
  constraint materials_artifact_id_key unique (artifact_id),
  constraint materials_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE
);

create index if not exists idx_materials_artifact on public.materials using btree (artifact_id);
create index if not exists idx_materials_state on public.materials using btree (state);

-- 2. Tabla de lecciones de materiales
create table if not exists public.material_lessons (
  id uuid not null default gen_random_uuid (),
  materials_id uuid not null,
  lesson_id text not null,
  lesson_title text not null,
  module_id text not null,
  module_title text not null,
  oa_text text not null,
  expected_components text[] not null default '{}'::text[],
  quiz_spec jsonb null,
  requires_demo_guide boolean null default false,
  dod jsonb not null default '{}'::jsonb,
  state text not null default 'PENDING'::text,
  iteration_count integer not null default 0,
  max_iterations integer not null default 5,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint material_lessons_pkey primary key (id),
  constraint material_lessons_materials_id_fkey foreign KEY (materials_id) references materials (id) on delete CASCADE
);

create index if not exists idx_material_lessons_materials on public.material_lessons using btree (materials_id);
create index if not exists idx_material_lessons_lesson on public.material_lessons using btree (lesson_id);

-- 3. Tabla de componentes generados
create table if not exists public.material_components (
  id uuid not null default gen_random_uuid (),
  material_lesson_id uuid not null,
  type text not null,
  content jsonb not null,
  source_refs text[] null default '{}'::text[],
  validation_status text not null default 'PENDING'::text,
  validation_errors text[] null default '{}'::text[],
  generated_at timestamp with time zone not null default now(),
  iteration_number integer not null default 1,
  constraint material_components_pkey primary key (id),
  constraint material_components_material_lesson_id_fkey foreign KEY (material_lesson_id) references material_lessons (id) on delete CASCADE
);

create index if not exists idx_material_components_lesson on public.material_components using btree (material_lesson_id);
create index if not exists idx_material_components_type on public.material_components using btree (type);

-- 4. Triggers para updated_at (solo si no existen)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_materials_updated_at') THEN
    CREATE TRIGGER update_materials_updated_at 
    BEFORE UPDATE ON materials 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_material_lessons_updated_at') THEN
    CREATE TRIGGER update_material_lessons_updated_at 
    BEFORE UPDATE ON material_lessons 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 5. Agregar configuración de modelo para Materials (si no existe)
INSERT INTO model_settings (setting_type, model_name, fallback_model, temperature, is_active)
SELECT 'MATERIALS', 'gemini-2.5-pro', 'gemini-2.5-flash', 0.7, true
WHERE NOT EXISTS (
  SELECT 1 FROM model_settings WHERE setting_type = 'MATERIALS'
);
