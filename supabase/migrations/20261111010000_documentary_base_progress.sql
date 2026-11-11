begin;

create function public.record_documentary_base_progress(
  p_artifact uuid, p_organization uuid, p_execution uuid,
  p_phase text, p_confirmed integer, p_total integer, p_started_at timestamptz
) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if p_started_at is null or p_phase is null or p_phase not in ('reading','writing','verifying')
    or (p_confirmed is null) <> (p_total is null)
    or (p_total is not null and (p_total < 1 or p_confirmed < 0 or p_confirmed > p_total))
    or (p_phase='reading' and p_total is null) then
    raise exception 'SOURCE_BASE_PROGRESS_INVALID';
  end if;

  update public.artifacts
    set generation_metadata = jsonb_set(
      coalesce(generation_metadata,'{}'::jsonb), '{base_progress}',
      jsonb_build_object('phase',p_phase,'confirmed',p_confirmed,'total',p_total,'started_at',p_started_at)
    )
    where id=p_artifact and organization_id=p_organization and state='GENERATING'
      and generation_metadata->>'run_id'=p_execution::text;
  return found;
end $$;

revoke all on function public.record_documentary_base_progress(uuid,uuid,uuid,text,integer,integer,timestamptz)
  from public,anon,authenticated;
grant execute on function public.record_documentary_base_progress(uuid,uuid,uuid,text,integer,integer,timestamptz)
  to service_role;

commit;
