
-- 1. Enable UUID extension
create extension if not exists "uuid-ossp";

-- 2. Define Enum Type for Artifact State (if not exists)
DO $$ BEGIN
    CREATE TYPE public.artifact_state AS ENUM ('DRAFT', 'GENERATING', 'READY_FOR_QA', 'APPROVED', 'REJECTED', 'ESCALATED', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Create Artifacts Table
create table if not exists public.artifacts (
  id uuid not null default uuid_generate_v4(),
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

-- Indices for Artifacts
create index IF not exists idx_artifacts_state on public.artifacts using btree (state) TABLESPACE pg_default;
create index IF not exists idx_artifacts_created_by on public.artifacts using btree (created_by) TABLESPACE pg_default;
create index IF not exists idx_artifacts_created_at on public.artifacts using btree (created_at desc) TABLESPACE pg_default;


-- 4. Create Syllabus Table
create table if not exists public.syllabus (
  id uuid not null default gen_random_uuid (),
  artifact_id uuid not null,
  route text not null default 'B_NO_SOURCE'::text,
  modules jsonb not null default '[]'::jsonb,
  source_summary jsonb null,
  validation jsonb not null default '{"checks": [], "automatic_pass": false}'::jsonb,
  qa jsonb not null default '{"status": "PENDING"}'::jsonb,
  state text not null default 'STEP_DRAFT'::text,
  iteration_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint syllabus_pkey primary key (id),
  constraint syllabus_artifact_id_key unique (artifact_id),
  constraint syllabus_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE,
  constraint syllabus_route_check check (
    (
      route = any (array['A_WITH_SOURCE'::text, 'B_NO_SOURCE'::text])
    )
  )
) TABLESPACE pg_default;

-- Indices for Syllabus
create index IF not exists idx_syllabus_artifact on public.syllabus using btree (artifact_id) TABLESPACE pg_default;
create index IF not exists idx_syllabus_state on public.syllabus using btree (state) TABLESPACE pg_default;


-- 5. Trigger Function for Updated At
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply Triggers
drop trigger if exists update_artifacts_updated_at on public.artifacts;
create trigger update_artifacts_updated_at BEFORE update on artifacts for EACH row execute FUNCTION update_updated_at_column ();

drop trigger if exists update_syllabus_updated_at on public.syllabus;
create trigger update_syllabus_updated_at BEFORE update on syllabus for EACH row execute FUNCTION update_updated_at_column ();
