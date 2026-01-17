create table public.artifacts (
  id uuid not null default extensions.uuid_generate_v4 (),
  run_id text null,
  course_id text null,
  idea_central text not null,
  nombres jsonb not null default '[]'::jsonb,
  objetivos jsonb not null default '[]'::jsonb,
  descripcion jsonb not null default '{}'::jsonb,
  state public.artifact_state not null default 'DRAFT'::artifact_state,
  validation_report jsonb null,
  semantic_result jsonb null,
  auto_retry_count integer not null default 0,
  iteration_count integer not null default 0,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint artifacts_pkey primary key (id),
  constraint artifacts_created_by_fkey foreign KEY (created_by) references auth.users (id) on delete set null
) TABLESPACE pg_default;

create index IF not exists idx_artifacts_state on public.artifacts using btree (state) TABLESPACE pg_default;

create index IF not exists idx_artifacts_created_by on public.artifacts using btree (created_by) TABLESPACE pg_default;

create index IF not exists idx_artifacts_created_at on public.artifacts using btree (created_at desc) TABLESPACE pg_default;

create trigger update_artifacts_updated_at BEFORE
update on artifacts for EACH row
execute FUNCTION update_updated_at_column ();