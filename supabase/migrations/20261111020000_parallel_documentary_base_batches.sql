begin;

create or replace function public.command_course_source_batch(
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
  active_leases integer;
  available_slots integer;
  claimed jsonb:='[]'::jsonb;
  claim_status text:='NO_AVAILABLE_BATCH';
  next_retry timestamptz;
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
  if p_action in ('claim','claim_wave') then
    select count(*) into active_leases from public.course_source_batches b
      where b.run_id=p_run and state='LEASED' and lease_until>now();
    available_slots:=(case when p_action='claim_wave' then 3 else 1 end)-active_leases;
    if available_slots<=0 then return jsonb_build_object('status','BUSY'); end if;
    for batch in select * from public.course_source_batches b where b.run_id=p_run
      and ((state='PENDING' and retry_after<=now()) or (state='LEASED' and lease_until<=now()))
      order by path
    loop
      exit when jsonb_array_length(claimed)>=available_slots;
      if run.deadline<=now() or run.attempts>=run.max_attempts or run.reserved_tokens+batch.request_tokens>run.max_tokens then
        claim_status:='BUDGET_EXHAUSTED';
        exit;
      end if;
      if batch.attempts>=3 then
        update public.course_source_batches set state='PAUSED',lease=null,lease_until=null,diagnostic='ATTEMPTS_EXHAUSTED'
          where run_id=p_run and path=batch.path;
        claim_status:='PAUSED';
        if p_action='claim' then exit; end if;
        continue;
      end if;
      token:=gen_random_uuid();
      update public.course_source_batches set state='LEASED',lease=token,attempts=attempts+1,
        lease_until=least(run.deadline,now()+interval '3 minutes') where run_id=p_run and path=batch.path;
      run.attempts:=run.attempts+1;
      run.reserved_tokens:=run.reserved_tokens+batch.request_tokens;
      claimed:=claimed||jsonb_build_array(jsonb_build_object('status','LEASED','path',batch.path,'lease',token,
        'fragmentIds',batch.fragment_ids,'requestTokens',batch.request_tokens,'correctionUsed',batch.correction_used));
    end loop;
    if jsonb_array_length(claimed)>0 then
      update public.course_source_batch_runs set attempts=run.attempts,reserved_tokens=run.reserved_tokens where id=p_run;
      if p_action='claim' then return claimed->0; end if;
      return jsonb_build_object('status','LEASED','leases',claimed);
    end if;
    if p_action='claim_wave' and claim_status in ('NO_AVAILABLE_BATCH','PAUSED') and active_leases=0 then
      select min(retry_after) into next_retry from public.course_source_batches b
        where b.run_id=p_run and state='PENDING' and retry_after>now();
      if next_retry is not null then return jsonb_build_object('status','WAITING','retryAfter',next_retry); end if;
    end if;
    return jsonb_build_object('status',claim_status);
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

commit;
