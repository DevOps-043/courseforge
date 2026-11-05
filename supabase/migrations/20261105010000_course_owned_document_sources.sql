-- F1: contratos y recepción privada. No extrae texto ni inicia proveedores IA.
begin;

create table public.course_source_settings (
  artifact_id uuid primary key references public.artifacts(id),
  organization_id uuid not null,
  policy text check (policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB','WEB_ONLY')),
  revision integer not null default 0 check (revision >= 0),
  unique (artifact_id, organization_id)
);

create table public.course_source_drafts (
  organization_id uuid not null,
  created_by uuid not null references public.profiles(id),
  request_key uuid not null,
  artifact_id uuid not null unique references public.artifacts(id),
  requested_title text not null check (length(requested_title) between 1 and 300),
  created_at timestamptz not null default now(),
  primary key (organization_id, created_by, request_key),
  foreign key (artifact_id, organization_id) references public.course_source_settings(artifact_id, organization_id)
);

create table public.course_source_documents (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  organization_id uuid not null,
  created_by uuid not null references public.profiles(id),
  request_key uuid not null,
  filename text not null check (length(filename) between 1 and 255 and filename !~ '[[:cntrl:]/\\]'),
  mime_type text not null check (mime_type in ('application/pdf','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  size_bytes bigint not null check (size_bytes between 1 and 15728640),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  status text not null default 'RESERVED' check (status in ('RESERVED','UPLOADED','PROCESSING','READY','FAILED','RETIRED')),
  supersedes_id uuid,
  extraction_version text,
  diagnostic_code text,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  unique (artifact_id, id),
  unique (artifact_id, created_by, request_key),
  foreign key (artifact_id, organization_id) references public.course_source_settings(artifact_id, organization_id),
  foreign key (artifact_id, supersedes_id) references public.course_source_documents(artifact_id, id),
  check (storage_path = 'organizations/' || organization_id::text || '/courses/' || artifact_id::text || '/' || id::text),
  check (status = 'RESERVED' or (content_sha256 is not null and content_sha256 = expected_sha256 and uploaded_at is not null)),
  unique (artifact_id, expected_sha256)
);
create index course_source_documents_course_page on public.course_source_documents(artifact_id, created_at desc, id desc);
create index course_source_documents_org on public.course_source_documents(organization_id);
create index course_source_documents_hash on public.course_source_documents(artifact_id, expected_sha256);
create index course_source_drafts_daily on public.course_source_drafts(organization_id, created_by, created_at);

create function public.guard_course_source_document_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (to_jsonb(new) - array['status','content_sha256','uploaded_at','extraction_version','diagnostic_code'])
    is distinct from (to_jsonb(old) - array['status','content_sha256','uploaded_at','extraction_version','diagnostic_code'])
    or (old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256)
    or (old.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at)
    then raise exception 'SOURCE_CONFLICT'; end if;
  return new;
end $$;
create trigger course_source_document_identity before update on public.course_source_documents
  for each row execute function public.guard_course_source_document_identity();
revoke all on function public.guard_course_source_document_identity() from public,anon,authenticated;

create table public.course_source_fragments (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  document_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  text_content text not null check (length(text_content) between 1 and 40000),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  locator jsonb not null check (jsonb_typeof(locator) = 'object'),
  unique (artifact_id, document_id, id),
  unique (document_id, ordinal),
  foreign key (artifact_id, document_id) references public.course_source_documents(artifact_id, id)
);
create table public.course_source_assignments (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  document_id uuid not null,
  fragment_id uuid not null,
  lesson_id text not null check (length(lesson_id) between 1 and 200),
  syllabus_content_version integer not null check (syllabus_content_version >= 0),
  objective_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(objective_refs) = 'array'),
  status text not null default 'PROPOSED' check (status in ('PROPOSED','APPROVED','REJECTED')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  foreign key (artifact_id, document_id, fragment_id) references public.course_source_fragments(artifact_id, document_id, id),
  unique (artifact_id, lesson_id, syllabus_content_version, fragment_id),
  check (status <> 'APPROVED' or (reviewed_by is not null and reviewed_at is not null))
);
create table public.course_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.course_source_settings(artifact_id),
  execution_id uuid not null,
  stage text not null check (stage in ('BASE','SYLLABUS','PLAN','CURATION','MATERIALS')),
  policy text not null check (policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB','WEB_ONLY')),
  source_revision integer not null check (source_revision >= 0),
  syllabus_content_version integer not null check (syllabus_content_version >= 0),
  context_sha256 text not null check (context_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (artifact_id, id),
  unique (artifact_id, execution_id, stage)
);
create table public.course_source_snapshot_items (
  artifact_id uuid not null,
  snapshot_id uuid not null,
  document_id uuid not null,
  fragment_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  primary key (snapshot_id, fragment_id),
  unique (snapshot_id, ordinal),
  foreign key (artifact_id, snapshot_id) references public.course_source_snapshots(artifact_id, id),
  foreign key (artifact_id, document_id, fragment_id) references public.course_source_fragments(artifact_id, document_id, id)
);

-- Solo backend autorizado; ninguna política concede lectura directa desde navegador.
do $$
declare relation text;
begin
  foreach relation in array array['course_source_settings','course_source_drafts','course_source_documents',
    'course_source_fragments','course_source_assignments','course_source_snapshots','course_source_snapshot_items']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation);
    execute format('grant select, insert on public.%I to service_role', relation);
  end loop;
end $$;
grant update on public.course_source_documents to service_role;

create function public.create_course_source_draft(p_organization uuid, p_actor uuid, p_key uuid, p_title text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  existing public.course_source_drafts;
  course uuid := gen_random_uuid();
  daily_draft_limit constant integer := 50;
  organization_lock_seed constant integer := 715;
begin
  if p_organization is null or p_actor is null or p_key is null or p_title is null
    or length(btrim(p_title)) not between 1 and 300 then raise exception 'SOURCE_CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text, organization_lock_seed));
  select * into existing from public.course_source_drafts
    where organization_id=p_organization and created_by=p_actor and request_key=p_key;
  if found then
    if existing.requested_title <> btrim(p_title) then raise exception 'SOURCE_CONFLICT'; end if;
    return existing.artifact_id;
  end if;
  if (select count(*) from public.course_source_drafts where organization_id=p_organization
      and created_by=p_actor and created_at > now()-interval '24 hours') >= daily_draft_limit then raise exception 'SOURCE_QUOTA'; end if;
  insert into public.artifacts(id, organization_id, created_by, idea_central, course_id, state)
    values(course,p_organization,p_actor,btrim(p_title),'DOC-' || course::text,'DRAFT');
  insert into public.course_source_settings(artifact_id,organization_id) values(course,p_organization);
  insert into public.course_source_drafts(organization_id,created_by,request_key,artifact_id,requested_title)
    values(p_organization,p_actor,p_key,course,btrim(p_title));
  return course;
end $$;

create function public.reserve_course_source_upload(p_artifact uuid, p_organization uuid, p_actor uuid,
  p_key uuid, p_filename text, p_mime text, p_bytes bigint, p_sha256 text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  entry public.course_source_documents;
  document uuid := gen_random_uuid();
  organization_lock_seed constant integer := 715;
  course_document_limit constant integer := 50;
  course_byte_limit constant bigint := 209715200;
  organization_document_limit constant integer := 500;
  organization_byte_limit constant bigint := 2147483648;
begin
  if p_organization is null or p_actor is null or p_key is null then raise exception 'SOURCE_CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text, organization_lock_seed));
  perform 1 from public.artifacts where id=p_artifact and organization_id=p_organization;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  insert into public.course_source_settings(artifact_id,organization_id) values(p_artifact,p_organization)
    on conflict (artifact_id) do nothing;
  select * into entry from public.course_source_documents
    where artifact_id=p_artifact and created_by=p_actor and request_key=p_key;
  if found then
    if entry.filename <> p_filename or entry.mime_type <> p_mime or entry.size_bytes <> p_bytes
      or entry.expected_sha256 <> p_sha256 then raise exception 'SOURCE_CONFLICT'; end if;
    return to_jsonb(entry);
  end if;
  if exists (select 1 from public.course_source_documents where artifact_id=p_artifact and expected_sha256=p_sha256)
    then raise exception 'SOURCE_CONFLICT'; end if;
  -- Las reservas vencidas cuentan hasta conciliación: no liberar cuota fingiendo que el objeto no existe.
  if (select count(*) from public.course_source_documents where artifact_id=p_artifact) >= course_document_limit
    or (select coalesce(sum(size_bytes),0) from public.course_source_documents where artifact_id=p_artifact)+p_bytes > course_byte_limit
    or (select count(*) from public.course_source_documents where organization_id=p_organization) >= organization_document_limit
    or (select coalesce(sum(size_bytes),0) from public.course_source_documents where organization_id=p_organization)+p_bytes > organization_byte_limit
    then raise exception 'SOURCE_QUOTA'; end if;
  insert into public.course_source_documents(id,artifact_id,organization_id,created_by,request_key,
    filename,mime_type,size_bytes,expected_sha256,storage_path)
  values(document,p_artifact,p_organization,p_actor,p_key,p_filename,p_mime,p_bytes,p_sha256,
    'organizations/' || p_organization::text || '/courses/' || p_artifact::text || '/' || document::text)
  returning * into entry;
  return to_jsonb(entry);
end $$;

create function public.confirm_course_source_upload(p_artifact uuid,p_organization uuid,p_actor uuid,
  p_document uuid,p_sha256 text,p_bytes bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare entry public.course_source_documents;
begin
  select * into entry from public.course_source_documents where id=p_document
    and artifact_id=p_artifact and organization_id=p_organization and created_by=p_actor for update;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  perform 1 from public.artifacts where id=p_artifact and organization_id=p_organization;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if p_sha256 is distinct from entry.expected_sha256 or p_bytes is distinct from entry.size_bytes then raise exception 'SOURCE_CONFLICT'; end if;
  if entry.status in ('UPLOADED','PROCESSING','READY') then return to_jsonb(entry); end if;
  if entry.status <> 'RESERVED' then raise exception 'SOURCE_CONFLICT'; end if;
  if entry.expires_at <= now() then raise exception 'SOURCE_EXPIRED'; end if;
  update public.course_source_documents set status='UPLOADED', content_sha256=p_sha256, uploaded_at=now()
    where id=p_document returning * into entry;
  return to_jsonb(entry);
end $$;

revoke all on function public.create_course_source_draft(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.reserve_course_source_upload(uuid,uuid,uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.confirm_course_source_upload(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.create_course_source_draft(uuid,uuid,uuid,text) to service_role;
grant execute on function public.reserve_course_source_upload(uuid,uuid,uuid,uuid,text,text,bigint,text) to service_role;
grant execute on function public.confirm_course_source_upload(uuid,uuid,uuid,uuid,text,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('course-source-originals','course-source-originals',false,15728640,
  array['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation']);

-- Restringe incluso políticas permisivas históricas sin alterar otros buckets.
create policy course_source_originals_private on storage.objects as restrictive
  for all to anon,authenticated
  using (bucket_id <> 'course-source-originals')
  with check (bucket_id <> 'course-source-originals');

commit;
