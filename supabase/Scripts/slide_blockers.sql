create table public.slide_blockers (
  id uuid not null default gen_random_uuid (),
  slides_id uuid not null,
  video_id text not null,
  code text not null,
  message text not null,
  severity text not null default 'ERROR'::text,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone null,
  resolved_by text null,
  constraint slide_blockers_pkey primary key (id),
  constraint slide_blockers_slides_id_fkey foreign KEY (slides_id) references slides (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_slide_blockers_slides on public.slide_blockers using btree (slides_id) TABLESPACE pg_default;