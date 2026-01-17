create table public.pipeline_events (
  id uuid not null default extensions.uuid_generate_v4 (),
  artifact_id uuid not null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  step_id text null,
  entity_id text null,
  entity_type text null,
  constraint pipeline_events_pkey primary key (id),
  constraint pipeline_events_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_pipeline_events_artifact_id on public.pipeline_events using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_pipeline_events_created_at on public.pipeline_events using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_pipeline_events_step on public.pipeline_events using btree (step_id) TABLESPACE pg_default;

create index IF not exists idx_pipeline_events_entity on public.pipeline_events using btree (entity_type, entity_id) TABLESPACE pg_default;