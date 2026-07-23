alter table public.curation_rows
  add column if not exists origin text not null default 'automatic',
  add column if not exists source_kind text not null default 'url',
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists content_sha256 text,
  add column if not exists validation_report jsonb not null default '{}'::jsonb,
  add column if not exists added_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'curation_rows_origin_check'
  ) then
    alter table public.curation_rows
      add constraint curation_rows_origin_check
      check (origin in ('automatic', 'manual'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'curation_rows_source_kind_check'
  ) then
    alter table public.curation_rows
      add constraint curation_rows_source_kind_check
      check (source_kind in ('url', 'pdf'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'curation_rows_file_size_check'
  ) then
    alter table public.curation_rows
      add constraint curation_rows_file_size_check
      check (file_size_bytes is null or file_size_bytes > 0);
  end if;
end $$;

create index if not exists curation_rows_curation_id_idx
  on public.curation_rows (curation_id);
create index if not exists curation_rows_lesson_id_idx
  on public.curation_rows (lesson_id);
create index if not exists curation_rows_origin_idx
  on public.curation_rows (origin);
create index if not exists curation_rows_source_kind_idx
  on public.curation_rows (source_kind);
drop index if exists public.curation_rows_unique_url_per_curation_idx;
drop index if exists public.curation_rows_unique_pdf_hash_per_curation_idx;

create index if not exists curation_rows_source_ref_per_curation_idx
  on public.curation_rows (curation_id, source_ref)
  where source_kind = 'url';

create index if not exists curation_rows_pdf_hash_per_curation_idx
  on public.curation_rows (curation_id, content_sha256)
  where source_kind = 'pdf' and content_sha256 is not null;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'curation-sources',
  'curation-sources',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
