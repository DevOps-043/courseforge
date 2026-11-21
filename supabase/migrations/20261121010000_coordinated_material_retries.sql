-- Architect. Reintentos acotados y cierre transaccional; no modifica contenido histórico.
alter table public.course_delivery_runs add column if not exists retry_units jsonb not null default '[]'::jsonb
  check (jsonb_typeof(retry_units) = 'array');

create or replace function public.reserve_material_lesson_retry(p_materials_id uuid,p_version integer,p_lesson uuid,p_iteration integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare parent public.materials; lesson public.material_lessons;
begin
  select * into parent from public.materials where id=p_materials_id for update;
  if parent.id is null or parent.version is distinct from p_version
    or parent.state not in ('PHASE3_GENERATING','PHASE3_NEEDS_FIX','PHASE3_REJECTED') then raise exception 'MATERIAL_RETRY_CONFLICT'; end if;
  select * into lesson from public.material_lessons where id=p_lesson and materials_id=p_materials_id for update;
  if lesson.id is null or lesson.state not in ('NEEDS_FIX','BLOCKED') or lesson.iteration_count is distinct from p_iteration
    or lesson.iteration_count>=lesson.max_iterations then raise exception 'MATERIAL_RETRY_CONFLICT'; end if;
  if (select count(*) from public.material_lessons where materials_id=p_materials_id and state='GENERATING')>=2 then raise exception 'MATERIAL_RETRY_CAPACITY'; end if;
  update public.material_lessons set state='GENERATING',iteration_count=iteration_count+1,updated_at=now() where id=p_lesson;
  update public.materials set state='PHASE3_GENERATING',qa_decision=null,updated_at=now() where id=p_materials_id;
  return lesson.iteration_count+1;
end $$;

create or replace function public.claim_material_generation(p_materials_id uuid,p_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare parent public.materials; lesson public.material_lessons;
begin
  select * into parent from public.materials where id=p_materials_id for update;
  if parent.id is null or parent.version is distinct from p_version or parent.state<>'PHASE3_GENERATING' then return null; end if;
  if (select count(*) from public.material_lessons where materials_id=p_materials_id and state='GENERATING')>=2 then return null; end if;
  update public.material_lessons set state='BLOCKED',updated_at=now() where materials_id=p_materials_id and state='PENDING' and iteration_count>=max_iterations;
  select * into lesson from public.material_lessons where materials_id=p_materials_id and state='PENDING' order by created_at,id limit 1 for update;
  if not found then return null; end if;
  update public.material_lessons set state='GENERATING',iteration_count=iteration_count+1,updated_at=now() where id=lesson.id returning * into lesson;
  update public.materials set updated_at=now() where id=p_materials_id;
  return to_jsonb(lesson);
end $$;

create or replace function public.finish_material_generation(p_materials_id uuid,p_version integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare parent public.materials; complete boolean;
begin
  select * into parent from public.materials where id=p_materials_id for update;
  if parent.id is null or parent.version is distinct from p_version or parent.state<>'PHASE3_GENERATING' then return false; end if;
  if exists(select 1 from public.material_lessons where materials_id=p_materials_id and state in ('PENDING','GENERATING')) then return false; end if;
  select count(*)>0 and bool_and(state in ('GENERATED','APPROVABLE')) into complete from public.material_lessons where materials_id=p_materials_id;
  update public.materials set state=case when complete then 'PHASE3_VALIDATING' else 'PHASE3_NEEDS_FIX' end,updated_at=now() where id=p_materials_id;
  return complete;
end $$;

create or replace function public.request_delivery_material_retry(p_artifact uuid,p_organization uuid,p_run uuid,p_unit text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare run public.course_delivery_runs; unit jsonb;
begin
  -- Locks en el mismo orden que commit/edición: workspace, run.
  perform 1 from public.course_delivery_workspaces where artifact_id=p_artifact and organization_id=p_organization for update;
  if not found then raise exception 'DELIVERY_RETRY_CONFLICT'; end if;
  select * into run from public.course_delivery_runs where id=p_run and artifact_id=p_artifact and organization_id=p_organization for update;
  if run.id is null or run.operation<>'MATERIALS' or run.status not in ('RUNNING','QUEUED','PAUSED','FAILED')
    or run.expected_revision<>(select revision from public.course_delivery_workspaces where artifact_id=p_artifact)
    or (run.status='RUNNING' and run.lease_expires_at<now()) then raise exception 'DELIVERY_RETRY_CONFLICT'; end if;
  select value into unit from jsonb_array_elements(run.units) where value->>'id'=p_unit;
  if unit is null or coalesce((unit->>'ready')::boolean,false) or unit->>'error' is null or coalesce((unit->>'attempts')::integer,0)>=4 or unit->>'retryable'='false' then raise exception 'DELIVERY_RETRY_CONFLICT'; end if;
  if not run.retry_units @> jsonb_build_array(p_unit) then
    update public.course_delivery_runs set retry_units=retry_units||jsonb_build_array(p_unit),updated_at=now() where id=p_run;
  end if;
  if run.status in ('PAUSED','FAILED') then
    update public.course_delivery_runs set status='QUEUED',lease_token=null,lease_expires_at=null where id=p_run;
    return true;
  end if;
  return false;
end $$;

create or replace function public.take_delivery_material_retry(p_run uuid,p_token uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare run public.course_delivery_runs; selected text;
begin
  select * into run from public.course_delivery_runs where id=p_run for update;
  if run.id is null or run.status<>'RUNNING' or run.lease_token is distinct from p_token or run.lease_expires_at<now() then raise exception 'DELIVERY_STALE_RUN'; end if;
  selected:=run.retry_units->>0;
  if selected is not null then
    update public.course_delivery_runs set retry_units=retry_units-0,
      units=(select jsonb_agg(case when value->>'id'=selected then value-'error' else value end order by ord) from jsonb_array_elements(units) with ordinality as u(value,ord)),updated_at=now() where id=p_run;
  end if;
  return selected;
end $$;

create or replace function public.finish_delivery_material_run(p_run uuid,p_token uuid,p_status text,p_error text,p_halt boolean default false)
returns text language plpgsql security invoker set search_path = '' as $$
declare run public.course_delivery_runs; next_status text;
begin
  select * into run from public.course_delivery_runs where id=p_run for update;
  if run.id is null or run.status<>'RUNNING' or run.lease_token is distinct from p_token or run.lease_expires_at<now() then return 'NOT_CLAIMED'; end if;
  if p_status not in ('COMPLETED','FAILED','PAUSED') then raise exception 'DELIVERY_INVALID_STATUS'; end if;
  next_status:=case when not p_halt and jsonb_array_length(run.retry_units)>0 then 'QUEUED' else p_status end;
  update public.course_delivery_runs set status=next_status,retry_units=case when p_halt then '[]'::jsonb else retry_units end,lease_token=null,lease_expires_at=null,last_error=p_error,updated_at=now() where id=p_run;
  return next_status;
end $$;

revoke all on function public.reserve_material_lesson_retry(uuid,integer,uuid,integer),public.finish_material_generation(uuid,integer),public.request_delivery_material_retry(uuid,uuid,uuid,text),public.take_delivery_material_retry(uuid,uuid),public.finish_delivery_material_run(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_material_lesson_retry(uuid,integer,uuid,integer),public.finish_material_generation(uuid,integer),public.request_delivery_material_retry(uuid,uuid,uuid,text),public.take_delivery_material_retry(uuid,uuid),public.finish_delivery_material_run(uuid,uuid,text,text,boolean) to service_role;
revoke all on function public.claim_material_generation(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_material_generation(uuid,integer) to service_role;
