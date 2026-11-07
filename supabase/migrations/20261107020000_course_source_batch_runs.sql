begin;

create table public.course_source_batch_runs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  organization_id uuid not null,
  revision integer not null,
  purpose_hash text not null check (purpose_hash ~ '^[a-f0-9]{64}$'),
  planner_version text not null check (length(planner_version) between 1 and 80),
  plan jsonb not null,
  deadline timestamptz not null,
  max_attempts integer not null check (max_attempts between 1 and 2048),
  max_splits integer not null check (max_splits between 0 and 512),
  max_tokens integer not null check (max_tokens between 1 and 20000000),
  attempts integer not null default 0,
  splits integer not null default 0,
  reserved_tokens integer not null default 0,
  foreign key (artifact_id, organization_id) references public.course_source_settings(artifact_id, organization_id),
  unique (artifact_id, revision, purpose_hash, planner_version)
);

create table public.course_source_batches (
  run_id uuid not null references public.course_source_batch_runs(id),
  path integer[] not null,
  fragment_ids uuid[] not null check (cardinality(fragment_ids) between 1 and 512),
  request_tokens integer not null check (request_tokens between 1 and 1000000),
  state text not null default 'PENDING' check (state in ('PENDING','LEASED','CONFIRMED','SPLIT','PAUSED')),
  lease uuid,
  lease_until timestamptz,
  retry_after timestamptz not null default '-infinity',
  attempts integer not null default 0,
  diagnostic text,
  correction_used boolean not null default false,
  findings jsonb,
  primary key (run_id, path)
);

alter table public.course_source_batch_runs enable row level security;
alter table public.course_source_batches enable row level security;
revoke all on public.course_source_batch_runs, public.course_source_batches from public, anon, authenticated, service_role;

create function public.create_course_source_batch_run(
  p_artifact uuid, p_organization uuid, p_revision integer, p_purpose_hash text,
  p_planner text, p_plan jsonb, p_deadline timestamptz, p_attempts integer, p_splits integer, p_tokens integer
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  existing public.course_source_batch_runs;
  settings public.course_source_settings;
  run_id uuid;
  expected uuid[];
  supplied uuid[];
begin
  select s.* into settings from public.course_source_settings s join public.artifacts a on a.id=s.artifact_id
    where s.artifact_id=p_artifact and s.organization_id=p_organization and a.organization_id=p_organization
    for share of s;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if settings.policy is null or settings.policy='WEB_ONLY' or settings.revision is distinct from p_revision then
    raise exception 'SOURCE_GENERATION_STALE';
  end if;
  select * into existing from public.course_source_batch_runs r where r.artifact_id=p_artifact
    and r.revision=p_revision and r.purpose_hash=p_purpose_hash and r.planner_version=p_planner;
  if found then
    if existing.plan is distinct from p_plan then raise exception 'SOURCE_CONFLICT'; end if;
    return existing.id;
  end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or octet_length(p_plan::text)>2000000
    then raise exception 'SOURCE_BATCH_PLAN_INVALID'; end if;
  if jsonb_array_length(p_plan) not between 1 and 512
    or p_deadline is null or p_deadline<=now() or p_deadline>now()+interval '24 hours'
    then raise exception 'SOURCE_BATCH_PLAN_INVALID'; end if;

  select array_agg(f.id order by f.document_id,f.ordinal) into expected
    from public.course_source_fragments f join public.course_source_documents d
      on d.id=f.document_id and d.artifact_id=f.artifact_id
    where f.artifact_id=p_artifact and d.status='READY';
  select array_agg(fragment::uuid order by batch_position, fragment_position) into supplied
    from jsonb_array_elements(p_plan) with ordinality as batch(item,batch_position)
    cross join lateral jsonb_array_elements_text(item->'fragmentIds') with ordinality as ids(fragment,fragment_position);
  if expected is null or supplied is distinct from expected then raise exception 'SOURCE_BATCH_COVERAGE_INVALID'; end if;

  insert into public.course_source_batch_runs(artifact_id,organization_id,revision,purpose_hash,planner_version,plan,deadline,max_attempts,max_splits,max_tokens)
    values(p_artifact,p_organization,p_revision,p_purpose_hash,p_planner,p_plan,p_deadline,p_attempts,p_splits,p_tokens)
    on conflict (artifact_id,revision,purpose_hash,planner_version) do nothing returning id into run_id;
  if run_id is null then
    select * into existing from public.course_source_batch_runs r where r.artifact_id=p_artifact
      and r.revision=p_revision and r.purpose_hash=p_purpose_hash and r.planner_version=p_planner;
    if existing.plan is distinct from p_plan then raise exception 'SOURCE_CONFLICT'; end if;
    return existing.id;
  end if;
  insert into public.course_source_batches(run_id,path,fragment_ids,request_tokens)
    select run_id,array[position::integer],array(select value::uuid from jsonb_array_elements_text(item->'fragmentIds')),
      (item->>'requestTokens')::integer
    from jsonb_array_elements(p_plan) with ordinality as batch(item,position);
  return run_id;
end $$;

create function public.command_course_source_batch(
  p_run uuid, p_organization uuid, p_action text, p_path integer[] default null,
  p_lease uuid default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  run public.course_source_batch_runs;
  batch public.course_source_batches;
  revision integer;
  token uuid;
  midpoint integer;
  failure_code text;
  submitted_findings jsonb;
begin
  select r.* into run from public.course_source_batch_runs r join public.artifacts a on a.id=r.artifact_id
    where r.id=p_run and r.organization_id=p_organization and a.organization_id=p_organization for update of r;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  select s.revision into revision from public.course_source_settings s where s.artifact_id=run.artifact_id
    and s.organization_id=p_organization and s.policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB') for share;
  if revision is distinct from run.revision then return jsonb_build_object('status','STALE'); end if;
  if p_action='status' then
    return (select jsonb_build_object('status',case when count(*) filter(where state not in ('CONFIRMED','SPLIT'))=0 then 'COMPLETE'
      when run.deadline<=now() or (count(*) filter(where state='LEASED' and lease_until>now())=0
        and (run.attempts>=run.max_attempts or run.reserved_tokens+min(request_tokens) filter(where state not in ('CONFIRMED','SPLIT'))>run.max_tokens))
        then 'BUDGET_EXHAUSTED'
      when count(*) filter(where state in ('PENDING','LEASED'))=0 then 'PAUSED' else 'ACTIVE' end,
      'confirmed',count(*) filter(where state='CONFIRMED'),'total',count(*) filter(where state<>'SPLIT'),
      'paused',count(*) filter(where state='PAUSED'),'attempts',run.attempts,'reservedTokens',run.reserved_tokens)
      from public.course_source_batches b where b.run_id=p_run);
  end if;
  if p_action='claim' then
    if exists(select 1 from public.course_source_batches b where b.run_id=p_run and state='LEASED' and lease_until>now())
      then return jsonb_build_object('status','BUSY'); end if;
    select * into batch from public.course_source_batches b where b.run_id=p_run
      and ((state='PENDING' and retry_after<=now()) or (state='LEASED' and lease_until<=now()))
      order by path limit 1;
    if not found then return jsonb_build_object('status','NO_AVAILABLE_BATCH'); end if;
    if run.deadline<=now() or run.attempts>=run.max_attempts or run.reserved_tokens+batch.request_tokens>run.max_tokens
      then return jsonb_build_object('status','BUDGET_EXHAUSTED'); end if;
    if batch.attempts>=3 then
      update public.course_source_batches set state='PAUSED',lease=null,lease_until=null,diagnostic='ATTEMPTS_EXHAUSTED'
        where run_id=p_run and path=batch.path;
      return jsonb_build_object('status','PAUSED');
    end if;
    token:=gen_random_uuid();
    update public.course_source_batches set state='LEASED',lease=token,attempts=attempts+1,
      lease_until=least(run.deadline,now()+interval '3 minutes') where run_id=p_run and path=batch.path;
    update public.course_source_batch_runs set attempts=attempts+1,reserved_tokens=reserved_tokens+batch.request_tokens where id=p_run;
    return jsonb_build_object('status','LEASED','path',batch.path,'lease',token,'fragmentIds',batch.fragment_ids,
      'requestTokens',batch.request_tokens,'correctionUsed',batch.correction_used);
  end if;
  select * into batch from public.course_source_batches b where b.run_id=p_run and b.path=p_path;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if p_action='read' then
    return jsonb_build_object('status',batch.state,'findings',batch.findings,'diagnostic',batch.diagnostic);
  end if;
  if p_action='complete' and batch.state='CONFIRMED' then
    if batch.lease is not distinct from p_lease and batch.findings is not distinct from p_payload->'findings'
      then return jsonb_build_object('status','CONFIRMED'); end if;
    raise exception 'SOURCE_CONFLICT';
  end if;
  if p_action='resume' then
    if batch.state<>'PAUSED' or batch.diagnostic not in ('TRANSIENT','ATTEMPTS_EXHAUSTED','INVALID_OUTPUT')
      then raise exception 'SOURCE_CONFLICT'; end if;
    if run.deadline<=now() or run.attempts>=run.max_attempts or run.reserved_tokens+batch.request_tokens>run.max_tokens
      then return jsonb_build_object('status','BUDGET_EXHAUSTED'); end if;
    update public.course_source_batches set state='PENDING',attempts=0,retry_after=now()
      where run_id=p_run and path=p_path;
    return jsonb_build_object('status','PENDING');
  end if;
  if batch.state<>'LEASED' or p_lease is null or batch.lease is distinct from p_lease or batch.lease_until<=now()
    then raise exception 'SOURCE_CONFLICT'; end if;

  if p_action='complete' then
    submitted_findings:=p_payload->'findings';
    if jsonb_typeof(submitted_findings) is distinct from 'array' or octet_length(submitted_findings::text)>64000
      then raise exception 'SOURCE_BATCH_FINDINGS_INVALID'; end if;
    if jsonb_array_length(submitted_findings)>50 or exists(
      select 1 from jsonb_array_elements(submitted_findings) as entry(item)
      where jsonb_typeof(item->'finding') is distinct from 'string'
        or jsonb_typeof(item->'quote') is distinct from 'string'
        or coalesce(length(btrim(item->>'finding')),0) not between 1 and 2000
        or coalesce(length(btrim(item->>'quote')),0) not between 16 and 2000
        or not exists(select 1 from public.course_source_fragments f
          where f.id=any(batch.fragment_ids) and f.id::text=item->>'fragmentId'
            and f.artifact_id=run.artifact_id and strpos(f.text_content,item->>'quote')>0)
    ) then raise exception 'SOURCE_BATCH_FINDINGS_INVALID'; end if;
    update public.course_source_batches set state='CONFIRMED',findings=submitted_findings,diagnostic=null,lease_until=null
      where run_id=p_run and path=p_path;
    return jsonb_build_object('status','CONFIRMED');
  elsif p_action='split' then
    midpoint:=cardinality(batch.fragment_ids)/2;
    if midpoint=0 or run.splits>=run.max_splits then
      update public.course_source_batches set state='PAUSED',diagnostic='CONTEXT_LIMIT',lease=null,lease_until=null
        where run_id=p_run and path=p_path;
      return jsonb_build_object('status','PAUSED');
    end if;
    insert into public.course_source_batches(run_id,path,fragment_ids,request_tokens) values
      (p_run,p_path||1,batch.fragment_ids[1:midpoint],(p_payload->>'leftTokens')::integer),
      (p_run,p_path||2,batch.fragment_ids[midpoint+1:cardinality(batch.fragment_ids)],(p_payload->>'rightTokens')::integer);
    update public.course_source_batches set state='SPLIT',lease=null,lease_until=null where run_id=p_run and path=p_path;
    update public.course_source_batch_runs set splits=splits+1 where id=p_run;
    return jsonb_build_object('status','SPLIT');
  elsif p_action='fail' then
    failure_code:=p_payload->>'diagnostic';
    if failure_code is null or failure_code not in ('TRANSIENT','INVALID_OUTPUT','PERMANENT')
      then raise exception 'SOURCE_BATCH_DIAGNOSTIC_INVALID'; end if;
    update public.course_source_batches set state=case when batch.attempts<3
        and (failure_code='TRANSIENT' or (failure_code='INVALID_OUTPUT' and not batch.correction_used))
      then 'PENDING' else 'PAUSED' end, diagnostic=failure_code,
      correction_used=batch.correction_used or failure_code='INVALID_OUTPUT',lease=null,lease_until=null,
      retry_after=now()+interval '5 seconds'*power(2,batch.attempts-1)
      where run_id=p_run and path=p_path;
    return (select jsonb_build_object('status',b.state,'retryAfter',b.retry_after) from public.course_source_batches b
      where b.run_id=p_run and b.path=p_path);
  end if;
  raise exception 'SOURCE_BATCH_ACTION_INVALID';
end $$;

revoke all on function public.create_course_source_batch_run(uuid,uuid,integer,text,text,jsonb,timestamptz,integer,integer,integer),
  public.command_course_source_batch(uuid,uuid,text,integer[],uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_course_source_batch_run(uuid,uuid,integer,text,text,jsonb,timestamptz,integer,integer,integer),
  public.command_course_source_batch(uuid,uuid,text,integer[],uuid,jsonb) to service_role;

commit;
