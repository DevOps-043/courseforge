create table public.curation_rows (
  id uuid not null default gen_random_uuid (),
  curation_id uuid not null,
  lesson_id text not null,
  lesson_title text not null,
  component text not null,
  is_critical boolean not null default false,
  source_ref text not null,
  source_title text null,
  source_rationale text null,
  url_status text not null default 'PENDING'::text,
  http_status_code integer null,
  last_checked_at timestamp with time zone null,
  failure_reason text null,
  apta boolean null,
  motivo_no_apta text null,
  cobertura_completa boolean null,
  notes text null,
  auto_evaluated boolean null default false,
  auto_reason text null,
  forbidden_override boolean null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint curation_rows_pkey primary key (id),
  constraint curation_rows_curation_id_fkey foreign KEY (curation_id) references curation (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_curation_rows_curation on public.curation_rows using btree (curation_id) TABLESPACE pg_default;

create index IF not exists idx_curation_rows_lesson on public.curation_rows using btree (lesson_id) TABLESPACE pg_default;

create index IF not exists idx_curation_rows_status on public.curation_rows using btree (url_status) TABLESPACE pg_default;

create trigger update_curation_rows_updated_at BEFORE
update on curation_rows for EACH row
execute FUNCTION update_updated_at_column ();