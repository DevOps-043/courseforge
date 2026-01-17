create table public.production_tasks (
  id uuid not null default gen_random_uuid (),
  course_id uuid not null,
  module_id text null,
  lesson_id text not null,
  video_id text not null,
  step_id public.production_step_id not null,
  state public.production_task_state not null default 'NOT_STARTED'::production_task_state,
  owner_user_id uuid null,
  qa_user_id uuid null,
  blocked_reason text null,
  escalated_to_role public.production_role null,
  checklist_json jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  started_at timestamp with time zone null,
  submitted_at timestamp with time zone null,
  approved_at timestamp with time zone null,
  constraint production_tasks_pkey primary key (id),
  constraint production_tasks_course_id_video_id_step_id_key unique (course_id, video_id, step_id),
  constraint production_tasks_course_id_fkey foreign KEY (course_id) references artifacts (id) on delete CASCADE,
  constraint production_tasks_owner_user_id_fkey foreign KEY (owner_user_id) references auth.users (id),
  constraint production_tasks_qa_user_id_fkey foreign KEY (qa_user_id) references auth.users (id)
) TABLESPACE pg_default;

create index IF not exists idx_production_tasks_course on public.production_tasks using btree (course_id) TABLESPACE pg_default;

create index IF not exists idx_production_tasks_state on public.production_tasks using btree (state) TABLESPACE pg_default;

create index IF not exists idx_production_tasks_step on public.production_tasks using btree (step_id) TABLESPACE pg_default;

create index IF not exists idx_production_tasks_owner on public.production_tasks using btree (owner_user_id) TABLESPACE pg_default;

create index IF not exists idx_production_tasks_video on public.production_tasks using btree (video_id) TABLESPACE pg_default;

create index IF not exists idx_production_tasks_qa_queue on public.production_tasks using btree (state) TABLESPACE pg_default
where
  (state = 'READY_FOR_QA'::production_task_state);

create trigger update_production_tasks_updated_at BEFORE
update on production_tasks for EACH row
execute FUNCTION update_updated_at_column ();