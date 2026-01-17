create table public.slides (
  id uuid not null default gen_random_uuid (),
  artifact_id uuid not null,
  version integer not null default 1,
  branding jsonb not null default '{"fonts": [], "palette": []}'::jsonb,
  state text not null default 'STEP6_DRAFT'::text,
  qa_decision jsonb null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  videos jsonb null default '[]'::jsonb,
  global_blockers jsonb null default '[]'::jsonb,
  dod jsonb null default '{"checklist": [], "automatic_checks": []}'::jsonb,
  constraint slides_pkey primary key (id),
  constraint slides_artifact_id_key unique (artifact_id),
  constraint slides_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_slides_artifact on public.slides using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_slides_state on public.slides using btree (state) TABLESPACE pg_default;

create trigger update_slides_updated_at BEFORE
update on slides for EACH row
execute FUNCTION update_updated_at_column ();