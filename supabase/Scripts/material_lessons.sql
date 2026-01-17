create table public.material_lessons (
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
  max_iterations integer not null default 2,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint material_lessons_pkey primary key (id),
  constraint material_lessons_materials_id_fkey foreign KEY (materials_id) references materials (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_material_lessons_materials on public.material_lessons using btree (materials_id) TABLESPACE pg_default;

create index IF not exists idx_material_lessons_lesson on public.material_lessons using btree (lesson_id) TABLESPACE pg_default;

create trigger update_material_lessons_updated_at BEFORE
update on material_lessons for EACH row
execute FUNCTION update_updated_at_column ();