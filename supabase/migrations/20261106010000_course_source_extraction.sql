begin;
alter table public.course_source_documents add column extraction_token uuid,
  add column extraction_expires_at timestamptz, add column extraction_attempts integer not null default 0;

create function public.process_course_source_document(p_document uuid,p_artifact uuid,p_organization uuid,
  p_action text,p_token uuid,p_fragments jsonb default '[]') returns uuid
language plpgsql security invoker set search_path='' as $$
declare entry public.course_source_documents; fragment jsonb; lease uuid;
begin
  select d.* into entry from public.course_source_documents d join public.artifacts a on a.id=d.artifact_id
    where d.id=p_document and d.artifact_id=p_artifact and d.organization_id=p_organization
    and a.organization_id=p_organization for update of d;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if p_action='retire' then
    if entry.status='RESERVED' then raise exception 'SOURCE_CONFLICT'; end if;
    update public.course_source_documents set status='RETIRED',extraction_token=null where id=p_document;
    return null;
  end if;
  if p_action='reserve' then
    if entry.status='READY' then return null; end if;
    if entry.status='PROCESSING' and entry.extraction_expires_at>now() then return null; end if;
    if entry.status not in ('UPLOADED','FAILED','PROCESSING') or entry.extraction_attempts>=3 then raise exception 'SOURCE_CONFLICT'; end if;
    lease:=gen_random_uuid();
    update public.course_source_documents set status='PROCESSING',extraction_token=lease,
      extraction_expires_at=now()+interval '10 minutes',extraction_attempts=extraction_attempts+1 where id=p_document;
    return lease;
  end if;
  if entry.status<>'PROCESSING' or entry.extraction_token is distinct from p_token
    or entry.extraction_expires_at<=now() then raise exception 'SOURCE_CONFLICT'; end if;
  if p_action='fail' then
    update public.course_source_documents set status='FAILED',diagnostic_code='EXTRACTION_FAILED' where id=p_document;
  elsif p_action='complete' then
    if jsonb_typeof(p_fragments)<>'array' or jsonb_array_length(p_fragments) not between 1 and 40
      or (select coalesce(sum(length(value->>'text')),0) from jsonb_array_elements(p_fragments))>40000
      then raise exception 'SOURCE_CONFLICT'; end if;
    for fragment in select value from jsonb_array_elements(p_fragments) loop
      insert into public.course_source_fragments(artifact_id,document_id,ordinal,text_content,content_sha256,locator)
        values(p_artifact,p_document,(fragment->>'ordinal')::integer,fragment->>'text',fragment->>'sha256',fragment->'locator');
    end loop;
    update public.course_source_documents set status='READY',extraction_version='text-v1',diagnostic_code=null where id=p_document;
  else raise exception 'SOURCE_CONFLICT'; end if;
  return p_token;
end $$;
revoke all on function public.process_course_source_document(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.process_course_source_document(uuid,uuid,uuid,text,uuid,jsonb) to service_role;
-- Identidad original sigue inmutable; los campos de lease son controlados por la nueva RPC.
create or replace function public.guard_course_source_document_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (to_jsonb(new)-array['status','content_sha256','uploaded_at','extraction_version','diagnostic_code','extraction_token','extraction_expires_at','extraction_attempts'])
    is distinct from (to_jsonb(old)-array['status','content_sha256','uploaded_at','extraction_version','diagnostic_code','extraction_token','extraction_expires_at','extraction_attempts'])
    or (old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256)
    or (old.uploaded_at is not null and new.uploaded_at is distinct from old.uploaded_at) then raise exception 'SOURCE_CONFLICT'; end if;
  return new;
end $$;
commit;
