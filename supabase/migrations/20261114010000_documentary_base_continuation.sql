begin;

alter table public.course_source_batch_runs
  add column recovery_used boolean not null default false;
alter table public.course_source_batches
  add column invalid_output_reason text check (invalid_output_reason in (
    'INVALID_FORMAT','TOO_MANY_FINDINGS','FRAGMENT_NOT_IN_BATCH','QUOTE_NOT_IN_FRAGMENT'));

create function public.record_documentary_base_invalid_output(
  p_run uuid, p_organization uuid, p_path integer[], p_lease uuid,
  p_action text, p_payload jsonb, p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_action is null or p_action not in ('fail','split') or p_reason is null then
    raise exception 'SOURCE_BASE_DIAGNOSTIC_INVALID';
  end if;
  result := public.command_course_source_batch(p_run,p_organization,p_action,p_path,p_lease,p_payload);
  if result->>'status' in ('PENDING','PAUSED','SPLIT') then
    update public.course_source_batches set invalid_output_reason=p_reason
      where run_id=p_run and path=p_path;
  end if;
  return result;
end $$;

create function public.recover_documentary_base_batch_run(p_run uuid, p_artifact uuid, p_organization uuid)
returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.course_source_batch_runs r
  set recovery_used=true, deadline=now()+interval '2 hours'
  from public.course_source_settings s
  where r.id=p_run and r.artifact_id=p_artifact and r.organization_id=p_organization
    and s.artifact_id=r.artifact_id and s.organization_id=r.organization_id
    and s.revision=r.revision and s.policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB')
    and r.deadline<=now() and not r.recovery_used and r.attempts<r.max_attempts
    and exists(select 1 from public.course_source_batches b where b.run_id=r.id and b.state='CONFIRMED')
    and exists(select 1 from public.course_source_batches b where b.run_id=r.id
      and (b.state in ('PENDING','LEASED') or
        (b.state='PAUSED' and b.diagnostic in ('TRANSIENT','ATTEMPTS_EXHAUSTED','INVALID_OUTPUT')))
      and b.request_tokens<=r.max_tokens-r.reserved_tokens);
  return found;
end $$;

create index documentary_base_due_idx on public.artifacts (
  (generation_metadata->'base_queue'->>'scope'),
  (generation_metadata->'base_queue'->>'due_at')
) where state='GENERATING' and generation_metadata ? 'base_queue';

create function public.list_due_documentary_base(p_scope text, p_now text)
returns table(artifact_id uuid, organization_id uuid, run_id text)
language sql security invoker set search_path='' as $$
  select a.id, a.organization_id, a.generation_metadata->>'run_id'
  from public.artifacts a
  where a.state='GENERATING' and a.generation_metadata ? 'base_queue'
    and a.generation_metadata->'base_queue'->>'scope'=p_scope
    and a.generation_metadata->'base_queue'->>'due_at'<=p_now
  order by a.generation_metadata->'base_queue'->>'due_at', a.id
  limit 10
$$;

create function public.command_documentary_base_invocation(
  p_artifact uuid, p_organization uuid, p_run uuid, p_scope text,
  p_owner uuid, p_action text
) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
  queue jsonb;
  invocation_count integer;
  current_time_value timestamptz := clock_timestamp();
  expiration_reason text;
  expiration_message text;
begin
  select generation_metadata->'base_queue' into queue
  from public.artifacts where id=p_artifact and organization_id=p_organization
    and state='GENERATING' and generation_metadata->>'run_id'=p_run::text
    and generation_metadata->'base_queue'->>'scope'=p_scope
  for update;
  if not found then return false; end if;
  if p_action='claim' then
    if (queue->>'due_at')::timestamptz>current_time_value then return false; end if;
    invocation_count := (queue->>'invocations')::integer;
    if not exists(select 1 from public.course_source_settings s where s.artifact_id=p_artifact
      and s.organization_id=p_organization and s.revision=(queue->>'revision')::integer
      and s.policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB')) then
      expiration_reason := 'SOURCE_REVISION_CHANGED';
      expiration_message := 'Las fuentes cambiaron durante la lectura de Base. Actualiza el curso y vuelve a generar.';
    elsif (queue->>'expires_at')::timestamptz<=current_time_value then
      expiration_reason := 'EXECUTION_EXPIRED';
      expiration_message := 'Venció el plazo de lectura de Base. Se conservaron los lotes confirmados.';
    elsif invocation_count>=16 then
      expiration_reason := 'INVOCATIONS_EXHAUSTED';
      expiration_message := 'Se agotaron las continuaciones automáticas de Base. Se conservaron los lotes confirmados.';
    end if;
    if expiration_reason is not null then
      update public.artifacts set state='ESCALATED', validation_report=jsonb_build_object(
        'all_passed',false,'results',jsonb_build_array(jsonb_build_object(
          'code','GENERATION_FAILED','passed',false,'message',expiration_message)),
        'diagnostics',jsonb_build_object('stage','documentary_context','batchReason',expiration_reason))
      where id=p_artifact;
      return false;
    end if;
    -- El lease supera la vida máxima de la función background (15 minutos).
    queue := queue || jsonb_build_object('owner',p_owner,'invocations',invocation_count+1,
      'due_at',to_char((current_time_value+interval '16 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  elsif p_action in ('yield','retry') then
    if queue->>'owner' is distinct from p_owner::text then return false; end if;
    queue := (queue - 'owner') || jsonb_build_object(
      'due_at',to_char((current_time_value+case when p_action='retry' then interval '1 minute'
        else interval '0 seconds' end) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  else
    raise exception 'SOURCE_BASE_INVOCATION_ACTION_INVALID';
  end if;
  update public.artifacts set generation_metadata=jsonb_set(generation_metadata,'{base_queue}',queue)
  where id=p_artifact;
  return true;
end $$;

create function public.read_documentary_base_batch_status(p_run uuid, p_artifact uuid, p_organization uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  progress jsonb;
  budget_reason text;
begin
  progress := public.read_course_source_base_batch_progress(p_run,p_artifact,p_organization);
  if progress->>'status'='BUDGET_EXHAUSTED' then
    select case when deadline<=now() then 'EXECUTION_EXPIRED'
      when attempts>=max_attempts then 'ATTEMPTS_EXHAUSTED' else 'UNITS_EXHAUSTED' end
    into budget_reason from public.course_source_batch_runs
    where id=p_run and artifact_id=p_artifact and organization_id=p_organization;
    return progress || jsonb_build_object('budgetReason',budget_reason);
  end if;
  return progress;
end $$;

create function public.guard_documentary_base_continuation_result() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      if new.generation_metadata ? 'base_queue' then raise exception 'SOURCE_BASE_QUEUE_PRIVATE'; end if;
    elsif (new.generation_metadata->'base_queue') is distinct from (old.generation_metadata->'base_queue')
      and (old.state='GENERATING' or new.generation_metadata ? 'base_queue') then
      raise exception 'SOURCE_BASE_QUEUE_PRIVATE';
    elsif old.state='GENERATING' and old.generation_metadata ? 'base_queue' and (
      new.state is distinct from old.state or new.organization_id is distinct from old.organization_id
      or new.generation_metadata->'run_id' is distinct from old.generation_metadata->'run_id'
      or new.generation_metadata->'original_input' is distinct from old.generation_metadata->'original_input') then
      raise exception 'SOURCE_BASE_QUEUE_PRIVATE';
    end if;
  end if;
  if tg_op='INSERT' then return new; end if;
  if old.state='GENERATING' and old.generation_metadata ? 'base_queue'
    and new.source_evidence_id is not null
    and new.source_evidence_id is distinct from old.source_evidence_id
    and not exists(select 1 from public.course_source_settings s
      where s.artifact_id=old.id and s.organization_id=old.organization_id
        and s.revision=(old.generation_metadata->'base_queue'->>'revision')::integer
        and s.policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB')) then
    raise exception 'SOURCE_CONFLICT';
  end if;
  return new;
end $$;

create trigger a_guard_documentary_base_continuation_result
  before insert or update on public.artifacts
  for each row execute function public.guard_documentary_base_continuation_result();

revoke all on function public.list_due_documentary_base(text,text),
  public.command_documentary_base_invocation(uuid,uuid,uuid,text,uuid,text),
  public.read_documentary_base_batch_status(uuid,uuid,uuid),
  public.record_documentary_base_invalid_output(uuid,uuid,integer[],uuid,text,jsonb,text),
  public.recover_documentary_base_batch_run(uuid,uuid,uuid),
  public.guard_documentary_base_continuation_result()
  from public,anon,authenticated;
grant execute on function public.list_due_documentary_base(text,text),
  public.command_documentary_base_invocation(uuid,uuid,uuid,text,uuid,text),
  public.read_documentary_base_batch_status(uuid,uuid,uuid),
  public.record_documentary_base_invalid_output(uuid,uuid,integer[],uuid,text,jsonb,text),
  public.recover_documentary_base_batch_run(uuid,uuid,uuid) to service_role;

commit;
