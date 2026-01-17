create table public.material_blockers (
  id uuid not null default gen_random_uuid (),
  materials_id uuid not null,
  lesson_id text null,
  component_type text null,
  code text not null,
  message text not null,
  severity text not null default 'error'::text,
  auto_generated boolean null default false,
  status text not null default 'OPEN'::text,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone null,
  constraint material_blockers_pkey primary key (id),
  constraint material_blockers_materials_id_fkey foreign KEY (materials_id) references materials (id) on delete CASCADE,
  constraint material_blockers_status_check check (
    (
      status = any (
        array[
          'OPEN'::text,
          'MITIGATING'::text,
          'ACCEPTED'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_material_blockers_materials on public.material_blockers using btree (materials_id) TABLESPACE pg_default;