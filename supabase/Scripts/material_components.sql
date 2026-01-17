create table public.material_components (
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
) TABLESPACE pg_default;

create index IF not exists idx_material_components_lesson on public.material_components using btree (material_lesson_id) TABLESPACE pg_default;

create index IF not exists idx_material_components_type on public.material_components using btree (type) TABLESPACE pg_default;