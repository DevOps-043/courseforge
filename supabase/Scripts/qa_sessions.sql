create table public.qa_sessions (
  id uuid not null default extensions.uuid_generate_v4 (),
  artifact_id uuid not null,
  reviewer_id uuid null,
  decision public.qa_decision null,
  feedback text null,
  suggestions jsonb not null default '[]'::jsonb,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone null,
  constraint qa_sessions_pkey primary key (id),
  constraint qa_sessions_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE,
  constraint qa_sessions_reviewer_id_fkey foreign KEY (reviewer_id) references auth.users (id) on delete set null
) TABLESPACE pg_default;

create index IF not exists idx_qa_sessions_artifact_id on public.qa_sessions using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_qa_sessions_reviewer_id on public.qa_sessions using btree (reviewer_id) TABLESPACE pg_default;