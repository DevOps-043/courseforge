create table public.instructional_plans (
  id uuid not null default gen_random_uuid (),
  artifact_id uuid not null,
  lesson_plans jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  dod jsonb not null default '{"checklist": [], "semantic_checks": [], "automatic_checks": []}'::jsonb,
  approvals jsonb not null default '{"architect_status": "PENDING"}'::jsonb,
  final_status text null,
  state text not null default 'STEP_DRAFT'::text,
  iteration_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint instructional_plans_pkey primary key (id),
  constraint instructional_plans_artifact_id_key unique (artifact_id),
  constraint instructional_plans_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_instructional_plans_artifact on public.instructional_plans using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_instructional_plans_state on public.instructional_plans using btree (state) TABLESPACE pg_default;

create trigger update_instructional_plans_updated_at BEFORE
update on instructional_plans for EACH row
execute FUNCTION update_updated_at_column ();