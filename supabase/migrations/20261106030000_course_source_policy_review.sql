begin;
alter table public.course_source_settings add column approved_revision integer;
create table public.course_source_review_versions (
  artifact_id uuid not null references public.course_source_settings(artifact_id),
  revision integer not null, curriculum_hash text not null,
  associations jsonb not null check(jsonb_typeof(associations)='array' and jsonb_array_length(associations)<=1000),
  created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
  primary key(artifact_id,revision)
);
alter table public.course_source_review_versions enable row level security;
revoke all on public.course_source_review_versions from public,anon,authenticated;
grant select,insert on public.course_source_review_versions to service_role;
create table public.course_source_review_approvals (
  artifact_id uuid not null, revision integer not null, curriculum_hash text not null,
  reviewed_by uuid not null references public.profiles(id), reviewed_at timestamptz not null default now(),
  primary key(artifact_id,revision), foreign key(artifact_id,revision) references public.course_source_review_versions(artifact_id,revision)
);
alter table public.course_source_review_approvals enable row level security;
revoke all on public.course_source_review_approvals from public,anon,authenticated;
grant select,insert on public.course_source_review_approvals to service_role;
create table public.course_source_policy_changes (
  artifact_id uuid not null references public.course_source_settings(artifact_id),revision integer not null,
  policy text not null check(policy in('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB','WEB_ONLY')),
  changed_by uuid not null references public.profiles(id),changed_at timestamptz not null default now(),primary key(artifact_id,revision)
);
alter table public.course_source_policy_changes enable row level security;
revoke all on public.course_source_policy_changes from public,anon,authenticated;
grant select,insert on public.course_source_policy_changes to service_role;
grant update on public.course_source_settings to service_role;

create function public.course_source_curriculum(p_artifact uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare modules jsonb; plans jsonb; delivery jsonb; plan_state text;
begin
  select s.modules into modules from public.syllabus s where artifact_id=p_artifact;
  select p.lesson_plans,p.state into plans,plan_state from public.instructional_plans p where artifact_id=p_artifact;
  if to_regclass('public.course_delivery_workspaces') is not null then
    execute 'select document from public.course_delivery_workspaces where artifact_id=$1' into delivery using p_artifact;
    if delivery is not null then delivery:=jsonb_build_object('config',delivery->'config','agenda',delivery->'agenda','plans',delivery->'plans','planApproval',delivery->'planApproval'); end if;
  end if;
  return jsonb_build_object('modules',coalesce(modules,'[]'),'plans',coalesce(plans,'[]'),'planState',plan_state,
    'hash',md5(coalesce(modules::text,'[]')||coalesce(plans::text,'[]')||coalesce(plan_state,'')||coalesce(delivery::text,'{}')));
end $$;

create function public.invalidate_course_source_dependents(p_artifact uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  update public.artifacts set production_complete=false,state=case when state::text='GENERATING' then 'DRAFT' else state end,
    generation_metadata=coalesce(generation_metadata,'{}')||'{"source_configuration_dirty":true}'::jsonb where id=p_artifact;
  update public.syllabus set upstream_dirty=true,upstream_dirty_source='Fuentes documentales',
    state=case when state='STEP_GENERATING' then 'STEP_DRAFT' else state end where artifact_id=p_artifact;
  update public.instructional_plans set upstream_dirty=true,upstream_dirty_source='Fuentes documentales',
    state=case when state='STEP_GENERATING' then 'STEP_DRAFT' else state end where artifact_id=p_artifact;
  update public.curation set upstream_dirty=true,upstream_dirty_source='Fuentes documentales',attempt_number=attempt_number+1,
    state='PHASE2_BLOCKED',qa_decision=null where artifact_id=p_artifact;
  update public.materials set upstream_dirty=true,upstream_dirty_source='Fuentes documentales',version=version+1,
    state='PHASE3_NEEDS_FIX' where artifact_id=p_artifact;
  update public.publication_requests set upstream_dirty=true,upstream_dirty_source='Fuentes documentales' where artifact_id=p_artifact;
end $$;

create function public.change_course_source_review(p_artifact uuid,p_organization uuid,p_actor uuid,p_revision integer,
  p_curriculum text,p_action text,p_payload jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare entry public.course_source_settings; next_revision integer; association jsonb; review public.course_source_review_versions;
begin
  perform 1 from public.artifacts where id=p_artifact and organization_id=p_organization;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  insert into public.course_source_settings(artifact_id,organization_id) values(p_artifact,p_organization) on conflict do nothing;
  select * into entry from public.course_source_settings where artifact_id=p_artifact for update;
  perform 1 from public.syllabus where artifact_id=p_artifact for share;
  perform 1 from public.instructional_plans where artifact_id=p_artifact for share;
  if entry.revision is distinct from p_revision or public.course_source_curriculum(p_artifact)->>'hash' is distinct from p_curriculum then raise exception 'SOURCE_CONFLICT'; end if;
  if p_action='approve' then
    select * into review from public.course_source_review_versions where artifact_id=p_artifact and revision=p_revision;
    if not found or review.curriculum_hash<>p_curriculum or entry.policy is null or jsonb_array_length(review.associations)=0 then raise exception 'SOURCE_CONFLICT'; end if;
    for association in select value from jsonb_array_elements(review.associations) loop
      if coalesce((association->>'verified')::boolean,false)<>true
        or (coalesce((association->>'conflict')::boolean,false) and length(btrim(coalesce(association->>'resolution','')))=0) then raise exception 'SOURCE_CONFLICT'; end if;
      if association->>'evidenceType'='DOCUMENT' then
        perform 1 from public.course_source_fragments f join public.course_source_documents d on d.id=f.document_id
          where f.id=(association->>'evidenceId')::uuid and f.artifact_id=p_artifact and d.status='READY';
      else
        perform 1 from public.curation_rows r join public.curation c on c.id=r.curation_id where c.artifact_id=p_artifact
          and r.id=(association->>'evidenceId')::uuid and r.lesson_id=association->>'lessonId' and r.apta=true
          and coalesce(r.validation_report->>'status','valid')='valid' and entry.policy<>'DOCUMENTS_ONLY';
      end if;
      if not found then raise exception 'SOURCE_CONFLICT'; end if;
    end loop;
    insert into public.course_source_review_approvals values(p_artifact,p_revision,p_curriculum,p_actor,now()) on conflict do nothing;
    update public.course_source_settings set approved_revision=revision where artifact_id=p_artifact;
    insert into public.curation(artifact_id,state,attempt_number,qa_decision)
      values(p_artifact,'PHASE2_APPROVED',1,jsonb_build_object('decision','APPROVED','reviewed_by',p_actor,'source_revision',p_revision))
      on conflict(artifact_id) do update set state='PHASE2_APPROVED',upstream_dirty=false,
        qa_decision=jsonb_build_object('decision','APPROVED','reviewed_by',p_actor,'source_revision',p_revision);
    return p_revision;
  end if;
  next_revision:=entry.revision+1;
  if p_action='policy' then
    if p_payload->>'policy' is null or p_payload->>'policy' not in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB','WEB_ONLY') then raise exception 'SOURCE_CONFLICT'; end if;
    update public.course_source_settings set policy=p_payload->>'policy',revision=next_revision,approved_revision=null where artifact_id=p_artifact;
    insert into public.course_source_policy_changes values(p_artifact,next_revision,p_payload->>'policy',p_actor,now());
  elsif p_action='save' then
    if entry.policy is null or jsonb_typeof(p_payload->'associations') is distinct from 'array' then raise exception 'SOURCE_CONFLICT'; end if;
    for association in select value from jsonb_array_elements(p_payload->'associations') loop
      if association->>'evidenceType'='DOCUMENT' then
        perform 1 from public.course_source_fragments f join public.course_source_documents d on d.id=f.document_id
          where f.id=(association->>'evidenceId')::uuid and f.artifact_id=p_artifact and d.status='READY';
      elsif association->>'evidenceType'='WEB' and entry.policy<>'DOCUMENTS_ONLY' then
        perform 1 from public.curation_rows r join public.curation c on c.id=r.curation_id where c.artifact_id=p_artifact
          and r.id=(association->>'evidenceId')::uuid and r.lesson_id=association->>'lessonId' and r.apta=true
          and coalesce(r.validation_report->>'status','valid')='valid';
      else raise exception 'SOURCE_CONFLICT'; end if;
      if not found then raise exception 'SOURCE_CONFLICT'; end if;
    end loop;
    insert into public.course_source_review_versions values(p_artifact,next_revision,p_curriculum,p_payload->'associations',p_actor,now());
    update public.course_source_settings set revision=next_revision,approved_revision=null where artifact_id=p_artifact;
  else raise exception 'SOURCE_CONFLICT'; end if;
  return next_revision;
end $$;

create function public.course_source_settings_invalidation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.revision is distinct from old.revision or new.policy is distinct from old.policy then
    perform public.invalidate_course_source_dependents(new.artifact_id);
  end if;
  return new;
end $$;
create trigger course_source_settings_invalidation after update on public.course_source_settings
  for each row execute function public.course_source_settings_invalidation();

create function public.course_source_document_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status is distinct from old.status and (new.status='READY' or old.status='READY') then
    update public.course_source_settings set revision=revision+1,approved_revision=null where artifact_id=new.artifact_id and policy is distinct from 'WEB_ONLY';
  end if;
  return new;
end $$;
create trigger course_source_document_revision after update on public.course_source_documents
  for each row execute function public.course_source_document_revision();

-- Los curso históricos sin configuración explícita conservan sus consumidores.
-- Un curso documental queda bloqueado en Materiales hasta integrar el contexto en F4.
create function public.guard_course_source_material_generation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.state in ('PHASE3_GENERATING','PHASE3_APPROVED') and exists(select 1 from public.course_source_settings
    where artifact_id=new.artifact_id and (policy is null or policy in ('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB'))) then
    raise exception 'SOURCE_CONTEXT_INTEGRATION_REQUIRED';
  end if;
  return new;
end $$;
create trigger course_source_material_generation before insert or update on public.materials
  for each row execute function public.guard_course_source_material_generation();

create function public.guard_course_source_curation_approval() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.state='PHASE2_APPROVED' and exists(select 1 from public.course_source_settings s where s.artifact_id=new.artifact_id
    and (s.policy is null or s.policy<>'WEB_ONLY') and (s.approved_revision is distinct from s.revision
      or not exists(select 1 from public.course_source_review_approvals a where a.artifact_id=s.artifact_id
        and a.revision=s.revision and a.curriculum_hash=public.course_source_curriculum(s.artifact_id)->>'hash'))) then
    raise exception 'SOURCE_REVIEW_REQUIRED';
  end if;
  return new;
end $$;
create trigger course_source_curation_approval before insert or update on public.curation
  for each row execute function public.guard_course_source_curation_approval();

create function public.guard_course_source_structure_generation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare artifact uuid;
begin
  if tg_table_name='artifacts' then artifact:=new.id; else artifact:=new.artifact_id; end if;
  if new.state::text in ('GENERATING','STEP_GENERATING') and exists(select 1 from public.course_source_settings
    where artifact_id=artifact and (policy is null or policy<>'WEB_ONLY')) then raise exception 'SOURCE_CONTEXT_INTEGRATION_REQUIRED'; end if;
  return new;
end $$;
create trigger course_source_base_generation before insert or update on public.artifacts
  for each row execute function public.guard_course_source_structure_generation();
create trigger course_source_syllabus_generation before insert or update on public.syllabus
  for each row execute function public.guard_course_source_structure_generation();
create trigger course_source_plan_generation before insert or update on public.instructional_plans
  for each row execute function public.guard_course_source_structure_generation();

create function public.course_source_web_evidence_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare artifact uuid;
begin
  if new.apta is distinct from old.apta or new.source_ref is distinct from old.source_ref
    or new.validation_report->>'status' is distinct from old.validation_report->>'status'
    or new.validation_report->>'content_excerpt' is distinct from old.validation_report->>'content_excerpt' then
    select artifact_id into artifact from public.curation where id=new.curation_id;
    update public.course_source_settings set revision=revision+1,approved_revision=null
      where artifact_id=artifact and policy in('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB');
  end if;
  return new;
end $$;
create trigger course_source_web_evidence_revision after update on public.curation_rows
  for each row execute function public.course_source_web_evidence_revision();

create function public.commit_course_source_curation_progress(p_curation_id uuid,p_attempt integer,p_revision integer,
  p_curriculum text,p_rows jsonb,p_completion jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare artifact uuid; settings public.course_source_settings;
begin
  select artifact_id into artifact from public.curation where id=p_curation_id;
  select * into settings from public.course_source_settings where artifact_id=artifact for update;
  if not found or settings.revision is distinct from p_revision or public.course_source_curriculum(artifact)->>'hash' is distinct from p_curriculum then return false; end if;
  if p_completion->>'state'='PHASE2_APPROVED' and settings.approved_revision is distinct from settings.revision then return false; end if;
  return public.commit_curation_progress(p_curation_id,p_attempt,p_rows,p_completion);
end $$;
revoke all on function public.commit_course_source_curation_progress(uuid,integer,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_course_source_curation_progress(uuid,integer,integer,text,jsonb,jsonb) to service_role;

revoke all on function public.course_source_curriculum(uuid) from public,anon,authenticated;
revoke all on function public.invalidate_course_source_dependents(uuid) from public,anon,authenticated;
revoke all on function public.change_course_source_review(uuid,uuid,uuid,integer,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.course_source_document_revision() from public,anon,authenticated;
revoke all on function public.guard_course_source_material_generation() from public,anon,authenticated;
revoke all on function public.course_source_settings_invalidation() from public,anon,authenticated;
revoke all on function public.guard_course_source_curation_approval() from public,anon,authenticated;
revoke all on function public.guard_course_source_structure_generation() from public,anon,authenticated;
revoke all on function public.course_source_web_evidence_revision() from public,anon,authenticated;
grant execute on function public.course_source_curriculum(uuid),public.invalidate_course_source_dependents(uuid),
  public.change_course_source_review(uuid,uuid,uuid,integer,text,text,jsonb) to service_role;
commit;
