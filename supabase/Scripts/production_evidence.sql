create table public.production_evidence (
  id uuid not null default gen_random_uuid (),
  task_id uuid not null,
  type public.production_evidence_type not null,
  url text null,
  label text not null,
  metadata_json jsonb null default '{}'::jsonb,
  captured_by uuid null,
  captured_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint production_evidence_pkey primary key (id),
  constraint production_evidence_captured_by_fkey foreign KEY (captured_by) references auth.users (id),
  constraint production_evidence_task_id_fkey foreign KEY (task_id) references production_tasks (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_production_evidence_task on public.production_evidence using btree (task_id) TABLESPACE pg_default;

create index IF not exists idx_production_evidence_type on public.production_evidence using btree (type) TABLESPACE pg_default;