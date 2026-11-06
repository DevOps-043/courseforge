begin;

-- Una única sustitución vigente por versión. Una carga fallida se recupera o retira.
create unique index course_source_single_successor on public.course_source_documents(supersedes_id)
  where supersedes_id is not null and status <> 'RETIRED';

create function public.reserve_course_source_upload_v2(p_artifact uuid,p_organization uuid,p_actor uuid,
  p_key uuid,p_filename text,p_mime text,p_bytes bigint,p_sha256 text,p_supersedes uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry public.course_source_documents; previous public.course_source_documents; document uuid:=gen_random_uuid();
  course_document_limit constant integer:=50; course_byte_limit constant bigint:=209715200;
  organization_document_limit constant integer:=500; organization_byte_limit constant bigint:=2147483648;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,715));
  if p_supersedes is null then
    if exists(select 1 from public.course_source_documents where artifact_id=p_artifact and created_by=p_actor
      and request_key=p_key and supersedes_id is not null) then raise exception 'SOURCE_CONFLICT'; end if;
    return public.reserve_course_source_upload(p_artifact,p_organization,p_actor,p_key,p_filename,p_mime,p_bytes,p_sha256);
  end if;
  perform 1 from public.artifacts where id=p_artifact and organization_id=p_organization;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  select * into entry from public.course_source_documents
    where artifact_id=p_artifact and created_by=p_actor and request_key=p_key;
  if found then
    if entry.supersedes_id is distinct from p_supersedes or entry.filename<>p_filename or entry.mime_type<>p_mime
      or entry.size_bytes<>p_bytes or entry.expected_sha256<>p_sha256 then raise exception 'SOURCE_CONFLICT'; end if;
    return to_jsonb(entry);
  end if;
  select * into previous from public.course_source_documents where id=p_supersedes and artifact_id=p_artifact
    and organization_id=p_organization for update;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if previous.status<>'READY' or exists(select 1 from public.course_source_documents where supersedes_id=p_supersedes and status<>'RETIRED')
    then raise exception 'SOURCE_CONFLICT'; end if;
  if (select count(*) from public.course_source_documents where artifact_id=p_artifact)>=course_document_limit
    or (select coalesce(sum(size_bytes),0) from public.course_source_documents where artifact_id=p_artifact)+p_bytes>course_byte_limit
    or (select count(*) from public.course_source_documents where organization_id=p_organization)>=organization_document_limit
    or (select coalesce(sum(size_bytes),0) from public.course_source_documents where organization_id=p_organization)+p_bytes>organization_byte_limit
    then raise exception 'SOURCE_QUOTA'; end if;
  insert into public.course_source_documents(id,artifact_id,organization_id,created_by,request_key,
    filename,mime_type,size_bytes,expected_sha256,storage_path,supersedes_id)
    values(document,p_artifact,p_organization,p_actor,p_key,p_filename,p_mime,p_bytes,p_sha256,
      'organizations/'||p_organization::text||'/courses/'||p_artifact::text||'/'||document::text,p_supersedes)
    returning * into entry;
  return to_jsonb(entry);
end $$;

create function public.activate_course_source_successor() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='READY' and old.status<>'READY' and new.supersedes_id is not null then
    update public.course_source_documents set status='RETIRED',extraction_token=null
      where id=new.supersedes_id and artifact_id=new.artifact_id and organization_id=new.organization_id and status='READY';
    if not found then raise exception 'SOURCE_CONFLICT'; end if;
  end if;
  return new;
end $$;
create trigger course_source_activate_successor after update on public.course_source_documents
  for each row execute function public.activate_course_source_successor();

create table public.course_source_upload_reconciliation (
  document_id uuid primary key references public.course_source_documents(id),
  observation text not null check(observation in('PRESENT','MISSING','UNKNOWN')),
  object_version text,
  observed_at timestamptz not null default now(),
  observed_by uuid not null references public.profiles(id),
  purge_authorized_by uuid references public.profiles(id),
  purged_at timestamptz
);
alter table public.course_source_upload_reconciliation enable row level security;
revoke all on public.course_source_upload_reconciliation from public,anon,authenticated;
grant select,insert,update on public.course_source_upload_reconciliation to service_role;

revoke all on function public.reserve_course_source_upload_v2(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_course_source_upload_v2(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) to service_role;
revoke all on function public.activate_course_source_successor() from public,anon,authenticated;
commit;
