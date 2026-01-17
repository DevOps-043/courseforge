create table public.slide_videos (
  id uuid not null default gen_random_uuid (),
  slides_id uuid not null,
  video_id text not null,
  lesson_id text not null,
  lesson_title text not null,
  module_id text not null,
  module_title text not null,
  module_index integer not null,
  lesson_index integer not null,
  tn_mn_vn text not null,
  script jsonb null,
  storyboard jsonb null,
  gamma_deck jsonb null,
  png_export jsonb null,
  dod jsonb not null default '{}'::jsonb,
  state text not null default 'PENDING'::text,
  iteration_count integer not null default 0,
  max_iterations integer not null default 2,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint slide_videos_pkey primary key (id),
  constraint slide_videos_slides_id_fkey foreign KEY (slides_id) references slides (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_slide_videos_slides on public.slide_videos using btree (slides_id) TABLESPACE pg_default;

create index IF not exists idx_slide_videos_lesson on public.slide_videos using btree (lesson_id) TABLESPACE pg_default;

create index IF not exists idx_slide_videos_tn_mn_vn on public.slide_videos using btree (tn_mn_vn) TABLESPACE pg_default;

create trigger update_slide_videos_updated_at BEFORE
update on slide_videos for EACH row
execute FUNCTION update_updated_at_column ();