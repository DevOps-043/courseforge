create table public.curation_blockers (
  id uuid not null default gen_random_uuid (),
  curation_id uuid not null,
  lesson_id text not null,
  lesson_title text not null,
  component text not null,
  impact text not null,
  owner text not null,
  status text not null default 'OPEN'::text,
  created_at timestamp with time zone not null default now(),
  constraint curation_blockers_pkey primary key (id),
  constraint curation_blockers_curation_id_fkey foreign KEY (curation_id) references curation (id) on delete CASCADE,
  constraint curation_blockers_status_check check (
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

create index IF not exists idx_curation_blockers_curation on public.curation_blockers using btree (curation_id) TABLESPACE pg_default;