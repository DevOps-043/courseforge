begin;

create table public.course_source_extraction_batches (
  document_id uuid not null references public.course_source_documents(id),
  first_ordinal integer not null check (first_ordinal between 0 and 127),
  lease uuid not null,
  fragments jsonb not null,
  primary key (document_id, first_ordinal)
);
alter table public.course_source_extraction_batches enable row level security;
revoke all on public.course_source_extraction_batches from public, anon, authenticated, service_role;

create function public.clean_course_source_extraction_batches() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.course_source_extraction_batches b where b.document_id=new.id
    and (new.status<>'PROCESSING' or b.lease is distinct from new.extraction_token);
  return new;
end $$;
revoke all on function public.clean_course_source_extraction_batches() from public,anon,authenticated,service_role;
create trigger course_source_extraction_batch_cleanup
  after update of status, extraction_token on public.course_source_documents for each row
  execute function public.clean_course_source_extraction_batches();

create function public.stage_course_source_extraction(
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
    if batch_start is null or batch_start<0 or batch_start+jsonb_array_length(p_fragments)>128
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

  if p_count is null or p_count not between 1 and 128 or p_characters is null
    or p_characters not between 50 and 250000 then raise exception 'SOURCE_BATCH_INVALID'; end if;
  with fragments as (
    select (item->>'ordinal')::integer as ordinal,
      (item#>>'{locator,characterStart}')::integer as start_at,
      (item#>>'{locator,characterEnd}')::integer as end_at,
      length(item->>'text')+length(regexp_replace(item->>'text','[^\U00010000-\U0010FFFF]','','g')) as units
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

  insert into public.course_source_fragments(artifact_id,document_id,ordinal,text_content,content_sha256,locator)
    select p_artifact,p_document,(item->>'ordinal')::integer,item->>'text',item->>'sha256',item->'locator'
    from public.course_source_extraction_batches b cross join lateral jsonb_array_elements(b.fragments) as items(item)
    where b.document_id=p_document and b.lease=p_token;
  update public.course_source_documents set status='READY',extraction_version='text-v2',
    diagnostic_code=null,extraction_expires_at=null where id=p_document;
end $$;

revoke all on function public.stage_course_source_extraction(uuid,uuid,uuid,uuid,text,jsonb,integer,integer)
  from public,anon,authenticated;
grant execute on function public.stage_course_source_extraction(uuid,uuid,uuid,uuid,text,jsonb,integer,integer)
  to service_role;

commit;
