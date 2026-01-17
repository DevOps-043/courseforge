
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

create index IF not exists idx_syllabus_artifact on public.syllabus using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_syllabus_state on public.syllabus using btree (state) TABLESPACE pg_default;

-- Trigger to update updated_at (assuming defining function exists or creating it if standard)
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_syllabus_updated_at BEFORE
update on syllabus for EACH row
execute FUNCTION update_updated_at_column ();
