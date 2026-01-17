create table public.validations (
  id uuid not null default gen_random_uuid (),
  artifact_id uuid not null,
  step_number integer not null,
  step_type text not null,
  validation_data jsonb not null default '{}'::jsonb,
  score numeric null,
  status text not null default 'PENDING'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint validations_pkey primary key (id),
  constraint validations_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id),
  constraint validations_status_check check (
    (
      status = any (
        array[
          'PENDING'::text,
          'IN_PROGRESS'::text,
          'COMPLETED'::text,
          'ERROR'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;