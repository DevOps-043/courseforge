begin;

create or replace function public.process_course_source_document(p_document uuid,p_artifact uuid,p_organization uuid,
  p_action text,p_token uuid,p_fragments jsonb default '[]') returns uuid
language plpgsql security invoker set search_path='' as $$
declare entry public.course_source_documents; fragment jsonb; lease uuid; diagnostic text; legacy_recovery boolean;
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
    -- Una oportunidad adicional para fallos genéricos anteriores a esta corrección.
    legacy_recovery := entry.status='FAILED' and entry.extraction_attempts=3
      and entry.diagnostic_code is not distinct from 'EXTRACTION_FAILED';
    if entry.status not in ('UPLOADED','FAILED','PROCESSING')
      or (entry.extraction_attempts>=3 and not legacy_recovery) then raise exception 'SOURCE_CONFLICT'; end if;
    lease:=gen_random_uuid();
    update public.course_source_documents set status='PROCESSING',extraction_token=lease,
      extraction_expires_at=now()+interval '10 minutes',extraction_attempts=extraction_attempts+1 where id=p_document;
    return lease;
  end if;
  if entry.status<>'PROCESSING' or entry.extraction_token is distinct from p_token
    or entry.extraction_expires_at<=now() then raise exception 'SOURCE_CONFLICT'; end if;
  if p_action='fail' then
    diagnostic := p_fragments->>'diagnosticCode';
    if diagnostic is null or diagnostic not in ('SOURCE_READ_FAILED','SOURCE_FORMAT_INVALID','TEXT_LIMIT','INSUFFICIENT_TEXT','SOURCE_PERSIST_FAILED') then
      diagnostic := 'EXTRACTION_FAILED';
    end if;
    update public.course_source_documents set status='FAILED',diagnostic_code=diagnostic,
      extraction_token=null,extraction_expires_at=null where id=p_document;
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

-- La invalidación de fuentes debe poder marcar una publicación existente como
-- desactualizada, incluso cuando su recibo acaba de perder vigencia.
create or replace function public.guard_course_source_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='artifacts' then
    if new.production_complete then perform public.assert_course_source_publication(new.id); end if;
  elsif new.status in ('READY','SENT','APPROVED') then
    if tg_op='UPDATE' then
      if new.upstream_dirty is true
        and (to_jsonb(new)-array['upstream_dirty','upstream_dirty_source','updated_at'])
          = (to_jsonb(old)-array['upstream_dirty','upstream_dirty_source','updated_at']) then
        return new;
      end if;
    end if;
    perform public.assert_course_source_publication(new.artifact_id);
  end if;
  return new;
end $$;

commit;
