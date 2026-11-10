begin;

alter table public.course_source_documents
  drop constraint course_source_documents_extraction_text_limit_check,
  add constraint course_source_documents_extraction_text_limit_check
    check (extraction_text_limit between 50 and 1200000);

alter table public.course_source_extraction_batches
  drop constraint course_source_extraction_batches_first_ordinal_check,
  add constraint course_source_extraction_batches_first_ordinal_check
    check (first_ordinal between 0 and 607);

create function public.course_source_utf16_units(p_text text) returns integer
language sql immutable strict set search_path='' as $$
  select length(p_text)+length(regexp_replace(p_text,'[^\U00010000-\U0010FFFF]','','g'));
$$;

-- El llamante autorizado serializa la publicación antes de bloquear el documento.
create function public.assert_course_source_text_budget(
  p_artifact uuid, p_document uuid, p_supersedes uuid, p_units bigint
) returns void language plpgsql security invoker set search_path='' as $$
declare existing_units bigint;
begin
  select coalesce(sum(public.course_source_utf16_units(f.text_content)),0) into existing_units
    from public.course_source_documents d join public.course_source_fragments f on f.document_id=d.id
    where d.artifact_id=p_artifact and d.status='READY' and d.id<>p_document
      and d.id is distinct from p_supersedes;
  if existing_units+p_units>1200000 then raise exception 'SOURCE_COURSE_TEXT_LIMIT'; end if;
end $$;

revoke all on function public.course_source_utf16_units(text),
  public.assert_course_source_text_budget(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.course_source_utf16_units(text),
  public.assert_course_source_text_budget(uuid,uuid,uuid,bigint) to service_role;

create or replace function public.process_course_source_document(p_document uuid,p_artifact uuid,p_organization uuid,
  p_action text,p_token uuid,p_fragments jsonb default '[]') returns uuid
language plpgsql security invoker set search_path='' as $$
declare entry public.course_source_documents; fragment jsonb; lease uuid; diagnostic text; legacy_recovery boolean; limit_recovery boolean; requested_limit integer;
begin
  if p_action in ('complete','retire') then
    perform pg_advisory_xact_lock(hashtextextended('course-source-publication:'||p_artifact::text,0));
  end if;
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
    -- Solo un worker capaz de usar el límite nuevo puede reservar su recuperación.
    if p_fragments->>'textLimitUnits' is not null then
      if p_fragments->>'textLimitUnits' not in ('600000','1200000') then raise exception 'SOURCE_CONFLICT'; end if;
      requested_limit:=(p_fragments->>'textLimitUnits')::integer;
    end if;
    limit_recovery := requested_limit is not null and entry.status='FAILED'
      and entry.diagnostic_code is not distinct from 'TEXT_LIMIT'
      and coalesce(entry.extraction_text_limit,0)<requested_limit;
    -- Una oportunidad adicional para fallos genéricos anteriores a esta corrección.
    legacy_recovery := entry.status='FAILED' and entry.extraction_attempts=3
      and entry.diagnostic_code is not distinct from 'EXTRACTION_FAILED';
    if entry.status not in ('UPLOADED','FAILED','PROCESSING')
      or (entry.extraction_attempts>=3 and not legacy_recovery and not limit_recovery) then raise exception 'SOURCE_CONFLICT'; end if;
    lease:=gen_random_uuid();
    update public.course_source_documents set status='PROCESSING',extraction_token=lease,
      extraction_expires_at=now()+interval '10 minutes',extraction_attempts=extraction_attempts+1,
      extraction_text_limit=coalesce(requested_limit,extraction_text_limit) where id=p_document;
    return lease;
  end if;
  if entry.status<>'PROCESSING' or entry.extraction_token is distinct from p_token
    or entry.extraction_expires_at<=now() then raise exception 'SOURCE_CONFLICT'; end if;
  if p_action='fail' then
    diagnostic := p_fragments->>'diagnosticCode';
    if diagnostic is null or diagnostic not in ('SOURCE_READ_FAILED','SOURCE_FORMAT_INVALID','TEXT_LIMIT','INSUFFICIENT_TEXT','SOURCE_PERSIST_FAILED','COURSE_TEXT_LIMIT') then
      diagnostic := 'EXTRACTION_FAILED';
    end if;
    update public.course_source_documents set status='FAILED',diagnostic_code=diagnostic,
      extraction_token=null,extraction_expires_at=null where id=p_document;
  elsif p_action='complete' then
    if jsonb_typeof(p_fragments)<>'array' or jsonb_array_length(p_fragments) not between 1 and 40
      or (select coalesce(sum(length(value->>'text')),0) from jsonb_array_elements(p_fragments))>40000
      then raise exception 'SOURCE_CONFLICT'; end if;
    perform public.assert_course_source_text_budget(p_artifact,p_document,entry.supersedes_id,(
      select coalesce(sum(public.course_source_utf16_units(value->>'text')),0)
      from jsonb_array_elements(p_fragments)
    ));
    for fragment in select value from jsonb_array_elements(p_fragments) loop
      insert into public.course_source_fragments(artifact_id,document_id,ordinal,text_content,content_sha256,locator)
        values(p_artifact,p_document,(fragment->>'ordinal')::integer,fragment->>'text',fragment->>'sha256',fragment->'locator');
    end loop;
    update public.course_source_documents set status='READY',extraction_version='text-v1',diagnostic_code=null where id=p_document;
  else raise exception 'SOURCE_CONFLICT'; end if;
  return p_token;
end $$;

create or replace function public.stage_course_source_extraction(
  p_document uuid, p_artifact uuid, p_organization uuid, p_token uuid,
  p_action text, p_fragments jsonb default null, p_count integer default null, p_characters integer default null
) returns void language plpgsql security definer set search_path='' as $$
declare
  entry public.course_source_documents;
  batch_start integer;
  existing jsonb;
  total integer;
  valid boolean;
begin
  if p_action='publish' then
    perform pg_advisory_xact_lock(hashtextextended('course-source-publication:'||p_artifact::text,0));
  end if;
  select d.* into entry from public.course_source_documents d join public.artifacts a on a.id=d.artifact_id
    where d.id=p_document and d.artifact_id=p_artifact and d.organization_id=p_organization
      and a.organization_id=p_organization for update of d;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  -- Recuperación tras una respuesta perdida de la publicación atómica.
  if p_action='publish' and entry.status='READY' and entry.extraction_version='text-v2'
    and p_token is not null and entry.extraction_token=p_token then return; end if;
  if entry.status<>'PROCESSING' or p_token is null or entry.extraction_token is distinct from p_token
    or entry.extraction_expires_at<=now() then raise exception 'SOURCE_CONFLICT'; end if;

  if p_action='append' then
    if jsonb_typeof(p_fragments) is distinct from 'array' or octet_length(p_fragments::text)>200000
      then raise exception 'SOURCE_BATCH_INVALID'; end if;
    if jsonb_array_length(p_fragments) not between 1 and 16 then raise exception 'SOURCE_BATCH_INVALID'; end if;
    batch_start:=(p_fragments->0->>'ordinal')::integer;
    if batch_start is null or batch_start<0 or batch_start+jsonb_array_length(p_fragments)>608
      or batch_start%16<>0 then raise exception 'SOURCE_BATCH_INVALID'; end if;
    if exists(select 1 from jsonb_array_elements(p_fragments) with ordinality as row(item,position)
      where (item->>'ordinal')::integer is distinct from batch_start+position-1
        or jsonb_typeof(item->'text') is distinct from 'string'
        or length(item->>'text') not between 1 and 2000
        or coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(item->'locator') is distinct from 'object')
      then raise exception 'SOURCE_BATCH_INVALID'; end if;
    select b.fragments into existing from public.course_source_extraction_batches b
      where b.document_id=p_document and b.first_ordinal=batch_start;
    if found then
      if existing is distinct from p_fragments then raise exception 'SOURCE_CONFLICT'; end if;
      return;
    end if;
    insert into public.course_source_extraction_batches(document_id,first_ordinal,lease,fragments)
      values(p_document,batch_start,p_token,p_fragments);
    return;
  elsif p_action<>'publish' or p_action is null then
    raise exception 'SOURCE_BATCH_ACTION_INVALID';
  end if;

  if p_count is null or p_count not between 1 and 608 or p_characters is null
    or p_characters not between 50 and coalesce(entry.extraction_text_limit,600000) then raise exception 'SOURCE_BATCH_INVALID'; end if;
  with fragments as (
    select (item->>'ordinal')::integer as ordinal,
      (item#>>'{locator,characterStart}')::integer as start_at,
      (item#>>'{locator,characterEnd}')::integer as end_at,
      public.course_source_utf16_units(item->>'text') as units
    from public.course_source_extraction_batches b cross join lateral jsonb_array_elements(b.fragments) as items(item)
    where b.document_id=p_document and b.lease=p_token
  ), ordered as (
    select *,row_number() over(order by ordinal)-1 as expected,
      coalesce(sum(units) over(order by ordinal rows between unbounded preceding and 1 preceding),0) as preceding
    from fragments
  )
  select count(*),bool_and(ordinal=expected and start_at is not distinct from preceding
    and end_at is not distinct from preceding+units) and sum(units)=p_characters into total,valid from ordered;
  if total<>p_count or valid is distinct from true then raise exception 'SOURCE_BATCH_INCOMPLETE'; end if;

  perform public.assert_course_source_text_budget(p_artifact,p_document,entry.supersedes_id,p_characters);
  insert into public.course_source_fragments(artifact_id,document_id,ordinal,text_content,content_sha256,locator)
    select p_artifact,p_document,(item->>'ordinal')::integer,item->>'text',item->>'sha256',item->'locator'
    from public.course_source_extraction_batches b cross join lateral jsonb_array_elements(b.fragments) as items(item)
    where b.document_id=p_document and b.lease=p_token;
  update public.course_source_documents set status='READY',extraction_version='text-v2',
    diagnostic_code=null,extraction_expires_at=null where id=p_document;
end $$;

commit;
