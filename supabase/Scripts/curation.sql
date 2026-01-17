create table public.curation (
  id uuid not null default gen_random_uuid (),
  artifact_id uuid not null,
  attempt_number integer not null default 1,
  state text not null default 'PHASE2_DRAFT'::text,
  qa_decision jsonb null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint curation_pkey primary key (id),
  constraint curation_artifact_id_key unique (artifact_id),
  constraint curation_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE,
  constraint curation_attempt_number_check check ((attempt_number = any (array[1, 2])))
) TABLESPACE pg_default;

create index IF not exists idx_curation_artifact on public.curation using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_curation_state on public.curation using btree (state) TABLESPACE pg_default;

create trigger update_curation_updated_at BEFORE
update on curation for EACH row
execute FUNCTION update_updated_at_column ();