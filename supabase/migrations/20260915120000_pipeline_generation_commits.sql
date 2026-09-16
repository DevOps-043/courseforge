-- Commit generated output only while its execution still owns the parent.
-- Parent locks serialize cancellation/restart with writes in the same transaction.
begin;
alter table public.curation drop constraint if exists curation_attempt_number_check;
alter table public.curation add constraint curation_attempt_number_check check (attempt_number >= 1);

create or replace function public.commit_curation_progress(
  p_curation_id uuid, p_attempt integer, p_rows jsonb, p_completion jsonb default null
) returns boolean language plpgsql security invoker set search_path = public as $$
declare current_curation public.curation%rowtype;
begin
  select * into current_curation from public.curation where id = p_curation_id for update;
  if not found or current_curation.state <> 'PHASE2_GENERATING'
    or current_curation.attempt_number is distinct from p_attempt then return false; end if;
  insert into public.curation_rows (
    curation_id, lesson_id, lesson_title, component, is_critical, source_ref,
    source_title, source_rationale, url_status, apta, cobertura_completa,
    auto_evaluated, auto_reason, origin, source_kind, validation_report
  ) select p_curation_id, r.lesson_id, r.lesson_title, r.component, r.is_critical,
    r.source_ref, r.source_title, r.source_rationale, r.url_status, r.apta,
    r.cobertura_completa, r.auto_evaluated, r.auto_reason, r.origin, r.source_kind,
    r.validation_report
  from jsonb_populate_recordset(null::public.curation_rows, p_rows) r
  where not exists (select 1 from public.curation_rows existing
    where existing.curation_id = p_curation_id and existing.lesson_id = r.lesson_id
      and existing.source_ref = r.source_ref);
  if p_completion is not null then
    if p_completion->>'state' not in ('PHASE2_APPROVED', 'PHASE2_BLOCKED') then
      raise exception 'Invalid curation completion';
    end if;
    update public.curation set state = p_completion->>'state',
      qa_decision = p_completion->'qa_decision', updated_at = now() where id = p_curation_id;
  else
    update public.curation set updated_at = now() where id = p_curation_id;
  end if;
  return true;
end $$;

create or replace function public.claim_material_generation(p_materials_id uuid, p_version integer)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare current_materials public.materials%rowtype; claimed public.material_lessons%rowtype;
begin
  select * into current_materials from public.materials where id = p_materials_id for update;
  if not found or current_materials.version is distinct from p_version
    or current_materials.state <> 'PHASE3_GENERATING' then return null; end if;
  select * into claimed from public.material_lessons
    where materials_id = p_materials_id and state = 'PENDING'
    order by created_at, id limit 1 for update;
  if not found then return null; end if;
  update public.material_lessons set state = 'GENERATING',
    iteration_count = iteration_count + 1, updated_at = now()
    where id = claimed.id returning * into claimed;
  update public.materials set updated_at = now() where id = p_materials_id;
  return to_jsonb(claimed);
end $$;

create or replace function public.reset_material_generation(
  p_materials_id uuid, p_version integer, p_stale_before timestamptz default null
) returns boolean language plpgsql security invoker set search_path = public as $$
declare current_materials public.materials%rowtype;
begin
  select * into current_materials from public.materials where id = p_materials_id for update;
  if not found or current_materials.version is distinct from p_version
    or current_materials.state <> 'PHASE3_GENERATING'
    or (p_stale_before is not null and current_materials.updated_at > p_stale_before) then return false; end if;
  update public.materials set version = version + 1, updated_at = now(),
    state = case when p_stale_before is null then 'PHASE3_DRAFT' else 'PHASE3_NEEDS_FIX' end
    where id = p_materials_id;
  update public.material_lessons set state = 'PENDING', updated_at = now()
    where materials_id = p_materials_id and state = 'GENERATING';
  return true;
end $$;

create or replace function public.start_material_generation(p_artifact_id uuid, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare current_materials public.materials%rowtype;
begin
  if p_expected_version is null then
    insert into public.materials(artifact_id, state, prompt_version)
      values (p_artifact_id, 'PHASE3_GENERATING', 'prompt05')
      on conflict (artifact_id) do nothing returning * into current_materials;
    if not found then return null; end if;
  else
    select * into current_materials from public.materials where artifact_id = p_artifact_id for update;
    if not found or current_materials.version is distinct from p_expected_version
      or current_materials.state not in ('PHASE3_DRAFT', 'PHASE3_NEEDS_FIX') then return null; end if;
    update public.materials set state = 'PHASE3_GENERATING', version = version + 1,
      qa_decision = null, updated_at = now() where id = current_materials.id
      returning * into current_materials;
    update public.material_lessons set state = 'PENDING', updated_at = now()
      where materials_id = current_materials.id and state in ('GENERATING', 'NEEDS_FIX', 'BLOCKED');
  end if;
  return jsonb_build_object('id', current_materials.id, 'version', current_materials.version);
end $$;

create or replace function public.commit_material_generation(
  p_materials_id uuid, p_version integer, p_lesson_id uuid, p_iteration integer,
  p_rows jsonb, p_success boolean, p_error text default null
) returns boolean language plpgsql security invoker set search_path = public as $$
declare current_materials public.materials%rowtype; current_lesson public.material_lessons%rowtype;
begin
  select * into current_materials from public.materials where id = p_materials_id for update;
  if not found or current_materials.version is distinct from p_version
    or current_materials.state = 'PHASE3_DRAFT' then return false; end if;
  select * into current_lesson from public.material_lessons
    where id = p_lesson_id and materials_id = p_materials_id for update;
  if not found or current_lesson.state <> 'GENERATING'
    or current_lesson.iteration_count is distinct from p_iteration then return false; end if;
  insert into public.material_components (
    material_lesson_id, type, content, source_refs, assets, validation_status,
    validation_errors, iteration_number, generated_at
  ) select p_lesson_id, r.type, r.content, r.source_refs, r.assets,
    r.validation_status, r.validation_errors, r.iteration_number, r.generated_at
  from jsonb_populate_recordset(null::public.material_components, p_rows) r
  on conflict (material_lesson_id, type) do update set
    content = excluded.content, source_refs = excluded.source_refs, assets = excluded.assets,
    validation_status = excluded.validation_status, validation_errors = excluded.validation_errors,
    iteration_number = excluded.iteration_number, generated_at = excluded.generated_at;
  update public.material_lessons set
    state = case when p_success then 'GENERATED' else 'NEEDS_FIX' end,
    dod = jsonb_build_object('control3_consistency', case when p_success then 'PENDING' else 'FAIL' end,
      'control4_sources', 'PENDING', 'control5_quiz', 'PENDING',
      'errors', case when p_success then '[]'::jsonb else jsonb_build_array(p_error) end),
    updated_at = now() where id = p_lesson_id;
  update public.materials set updated_at = now() where id = p_materials_id;
  return true;
end $$;

revoke all on function public.commit_curation_progress(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_curation_progress(uuid, integer, jsonb, jsonb) to service_role;
revoke all on function public.commit_material_generation(uuid, integer, uuid, integer, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.commit_material_generation(uuid, integer, uuid, integer, jsonb, boolean, text) to service_role;
revoke all on function public.claim_material_generation(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_material_generation(uuid, integer) to service_role;
revoke all on function public.reset_material_generation(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.reset_material_generation(uuid, integer, timestamptz) to service_role;
revoke all on function public.start_material_generation(uuid, integer) from public, anon, authenticated;
grant execute on function public.start_material_generation(uuid, integer) to service_role;
commit;
