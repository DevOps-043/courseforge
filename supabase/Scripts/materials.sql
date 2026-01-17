create table public.materials (
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
) TABLESPACE pg_default;

create index IF not exists idx_materials_artifact on public.materials using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_materials_state on public.materials using btree (state) TABLESPACE pg_default;

create trigger update_materials_updated_at BEFORE
update on materials for EACH row
execute FUNCTION update_updated_at_column ();