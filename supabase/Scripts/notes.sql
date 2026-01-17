create table public.notes (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  artifact_id uuid null,
  title text not null default ''::text,
  content text not null default ''::text,
  tags text[] null default '{}'::text[],
  color text null default 'default'::text,
  is_pinned boolean null default false,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint notes_pkey primary key (id),
  constraint notes_artifact_id_fkey foreign KEY (artifact_id) references artifacts (id) on delete CASCADE,
  constraint notes_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_notes_user_id on public.notes using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_notes_artifact_id on public.notes using btree (artifact_id) TABLESPACE pg_default;

create index IF not exists idx_notes_created_at on public.notes using btree (created_at desc) TABLESPACE pg_default;

create index IF not exists idx_notes_is_pinned on public.notes using btree (is_pinned) TABLESPACE pg_default;

create trigger notes_updated_at_trigger BEFORE
update on notes for EACH row
execute FUNCTION update_notes_updated_at ();