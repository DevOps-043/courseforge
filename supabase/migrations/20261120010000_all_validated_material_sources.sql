-- Architect: conjuntos completos de fuentes, sin selección manual por objetivo.
-- Aplicar antes del código consumidor. Conserva snapshots y revisiones históricos.
begin;

alter table public.course_source_snapshots
  add column if not exists selection_mode text not null default 'MANUAL',
  add column if not exists lesson_scope text[];
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.course_source_snapshots'::regclass and conname='source_snapshot_selection_mode') then
    alter table public.course_source_snapshots add constraint source_snapshot_selection_mode check(selection_mode in ('MANUAL','ALL_VALIDATED'));
  end if;
end $$;

create or replace function public.course_source_all_material_context(p_artifact uuid,p_organization uuid,p_lessons text[] default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings; curriculum jsonb; scope text[]; known text[]; sources jsonb; lesson text;
begin
  select s.* into settings from public.course_source_settings s join public.artifacts a on a.id=s.artifact_id and a.organization_id=s.organization_id
    where s.artifact_id=p_artifact and s.organization_id=p_organization;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if settings.policy is null or settings.policy='WEB_ONLY' then raise exception 'SOURCE_CONFLICT'; end if;
  curriculum:=public.course_source_curriculum(p_artifact);
  select array_agg(distinct coalesce(nullif(l->>'id',''),'lesson-'||mi||'-'||li) order by coalesce(nullif(l->>'id',''),'lesson-'||mi||'-'||li)) into known
    from jsonb_array_elements(coalesce(curriculum->'modules','[]')) with ordinality modules(m,mi),
      jsonb_array_elements(coalesce(m->'lessons','[]')) with ordinality lessons(l,li);
  select array_agg(distinct regexp_replace(id,'-G[0-9]+$','','i') order by regexp_replace(id,'-G[0-9]+$','','i')) into scope
    from unnest(coalesce(p_lessons,known)) id;
  if coalesce(cardinality(scope),0)=0 or cardinality(scope)>1000 or exists(select 1 from unnest(scope) id where not(id=any(coalesce(known,'{}')))) then raise exception 'SOURCE_CONFLICT'; end if;
  select coalesce(jsonb_agg(source order by source->>'kind',source->>'id'),'[]') into sources from (
    select jsonb_build_object('id',f.id,'documentId',f.document_id,'kind','DOCUMENT','title',d.filename,'text',f.text_content,
      'hash',f.content_sha256,'locator',f.locator,'lessonIds',to_jsonb(scope)) source
    from public.course_source_fragments f join public.course_source_documents d on d.id=f.document_id and d.artifact_id=f.artifact_id
    where f.artifact_id=p_artifact and d.status='READY' and length(btrim(f.text_content))>0
    union all
    select jsonb_build_object('id',r.id,'kind','WEB','title',coalesce(r.source_title,r.source_ref),'text',r.validation_report->>'content_excerpt',
      'hash',encode(sha256(convert_to(r.validation_report->>'content_excerpt','UTF8')),'hex'),'url',r.source_ref,
      'locator',jsonb_build_object('url',r.source_ref),'lessonIds',jsonb_build_array(r.lesson_id))
    from public.curation_rows r join public.curation c on c.id=r.curation_id
    where settings.policy='DOCUMENTS_AND_WEB' and c.artifact_id=p_artifact and r.lesson_id=any(scope) and r.apta=true
      and coalesce(to_jsonb(r)->>'source_kind','url')<>'pdf' and r.validation_report->>'status'='valid'
      and length(btrim(coalesce(r.validation_report->>'content_excerpt','')))>0
      and r.source_ref ~ '^https://[^/?#@]+(/[^?#]*)?$'
  ) available;
  if jsonb_array_length(sources)=0 then raise exception 'SOURCE_SET_INCOMPLETE'; end if;
  if jsonb_array_length(sources)>1000 then raise exception 'SOURCE_CONTEXT_BUDGET'; end if;
  foreach lesson in array scope loop
    if not exists(select 1 from jsonb_array_elements(sources) i where i->>'kind'='DOCUMENT' or (i->'lessonIds') ? lesson) then raise exception 'SOURCE_SET_INCOMPLETE'; end if;
  end loop;
  return jsonb_build_object('policy',settings.policy,'revision',settings.revision,'fingerprint',public.course_source_generation_fingerprint(p_artifact,'MATERIALS'),
    'scope',to_jsonb(scope),'sources',sources);
end $$;

create or replace function public.snapshot_all_course_source_materials(p_artifact uuid,p_organization uuid,p_execution uuid,p_lessons text[] default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare context jsonb; manifest jsonb; snapshot uuid; existing public.course_source_snapshots; chars bigint;
begin
  perform 1 from public.course_source_settings where artifact_id=p_artifact and organization_id=p_organization for update;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  context:=public.course_source_all_material_context(p_artifact,p_organization,p_lessons);
  select sum(length(i->>'text')) into chars from jsonb_array_elements(context->'sources') i;
  if chars>60000 then raise exception 'SOURCE_CONTEXT_BUDGET'; end if;
  select jsonb_agg(case when i->>'kind'='DOCUMENT' then i-'text' else i end order by i->>'kind',i->>'id') into manifest from jsonb_array_elements(context->'sources') i;
  select * into existing from public.course_source_snapshots where artifact_id=p_artifact and execution_id=p_execution and stage='MATERIALS';
  if found then
    if existing.selection_mode<>'ALL_VALIDATED' or existing.source_revision<>(context->>'revision')::integer
      or existing.input_fingerprint is distinct from context->>'fingerprint' or existing.manifest is distinct from manifest
      or to_jsonb(existing.lesson_scope) is distinct from context->'scope' then raise exception 'SOURCE_CONFLICT'; end if;
    snapshot:=existing.id;
  else
    insert into public.course_source_snapshots(artifact_id,execution_id,stage,policy,source_revision,syllabus_content_version,context_sha256,input_fingerprint,lesson_id,manifest,selection_mode,lesson_scope)
      values(p_artifact,p_execution,'MATERIALS',context->>'policy',(context->>'revision')::integer,
        coalesce((public.course_source_curriculum(p_artifact)->>'syllabusVersion')::integer,0),encode(sha256(convert_to((context->'sources')::text,'UTF8')),'hex'),context->>'fingerprint',
        case when jsonb_array_length(context->'scope')=1 then context#>>'{scope,0}' else null end,manifest,'ALL_VALIDATED',array(select jsonb_array_elements_text(context->'scope')))
      returning id into snapshot;
    insert into public.course_source_snapshot_items(artifact_id,snapshot_id,document_id,fragment_id,ordinal)
      select p_artifact,snapshot,(i->>'documentId')::uuid,(i->>'id')::uuid,(ordinality-1)::integer
      from jsonb_array_elements(manifest) with ordinality items(i,ordinality) where i->>'kind'='DOCUMENT';
  end if;
  return context||jsonb_build_object('snapshotId',snapshot,'artifactId',p_artifact,'stage','MATERIALS','lessonId',case when jsonb_array_length(context->'scope')=1 then context#>>'{scope,0}' else null end);
end $$;

-- Las funciones históricas se sustituyen abajo conservando validaciones de recibos.
create or replace function public.course_source_receipt_valid(p_receipt uuid,p_artifact uuid,p_stage text,p_output jsonb,p_lesson text default null) returns boolean
language sql security invoker set search_path='' as $$
  select exists(select 1 from public.course_source_generation_receipts r join public.course_source_snapshots s on s.id=r.snapshot_id
    where r.id=p_receipt and r.artifact_id=p_artifact and s.stage=p_stage and r.output_hash=md5(p_output::text)
      and (p_lesson is null or case when s.selection_mode='ALL_VALIDATED'
        then regexp_replace(p_lesson,'-G[0-9]+$','','i')=any(s.lesson_scope)
        else s.lesson_id=regexp_replace(p_lesson,'-G[0-9]+$','','i') end)
      and public.course_source_snapshot_current(s.id));
$$;

create or replace function public.course_source_snapshot_current(p_snapshot uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare snapshot public.course_source_snapshots; settings public.course_source_settings; item jsonb; current_text text; automatic jsonb; expected jsonb;
begin
  select * into snapshot from public.course_source_snapshots where id=p_snapshot;
  if not found or snapshot.input_fingerprint is null then return false; end if;
  select * into settings from public.course_source_settings where artifact_id=snapshot.artifact_id;
  if not found or settings.policy is distinct from snapshot.policy or snapshot.input_fingerprint is distinct from public.course_source_generation_fingerprint(snapshot.artifact_id,snapshot.stage) then return false; end if;
  if not exists(select 1 from public.artifacts where id=snapshot.artifact_id and organization_id=settings.organization_id) then return false; end if;
  if snapshot.selection_mode='ALL_VALIDATED' then
    begin
      automatic:=public.course_source_all_material_context(snapshot.artifact_id,settings.organization_id,snapshot.lesson_scope);
      select jsonb_agg(case when i->>'kind'='DOCUMENT' then i-'text' else i end order by i->>'kind',i->>'id') into expected from jsonb_array_elements(automatic->'sources') i;
      return snapshot.stage='MATERIALS' and settings.revision=snapshot.source_revision
        and snapshot.manifest=expected and to_jsonb(snapshot.lesson_scope)=automatic->'scope';
    exception when others then return false;
    end;
  end if;
  if snapshot.stage='MATERIALS' and (settings.revision is distinct from snapshot.source_revision or settings.approved_revision is distinct from settings.revision
    or not exists(select 1 from public.course_source_review_approvals where artifact_id=snapshot.artifact_id and revision=settings.revision and curriculum_hash=snapshot.input_fingerprint)) then return false; end if;
  for item in select value from jsonb_array_elements(snapshot.manifest) loop
    if item->>'kind'='DOCUMENT' then
      perform 1 from public.course_source_fragments f join public.course_source_documents d on d.id=f.document_id
        where f.id=(item->>'id')::uuid and f.artifact_id=snapshot.artifact_id and d.status='READY' and f.content_sha256=item->>'hash';
      if not found then return false; end if;
    else
      select r.validation_report->>'content_excerpt' into current_text from public.curation_rows r join public.curation c on c.id=r.curation_id
        where r.id=(item->>'id')::uuid and c.artifact_id=snapshot.artifact_id and r.apta=true
        and (snapshot.lesson_id is null or r.lesson_id=snapshot.lesson_id)
        and (not(item ? 'lessonIds') or (item->'lessonIds') ? r.lesson_id)
        and coalesce(to_jsonb(r)->>'source_kind','url')<>'pdf'
        and coalesce(r.validation_report->>'status','valid')='valid' and r.source_ref=item->>'url';
      if not found or current_text is distinct from item->>'text' then return false; end if;
    end if;
  end loop;
  -- Las primeras etapas consumen toda la selección READY; añadir un documento también las vuelve obsoletas.
  if snapshot.stage<>'MATERIALS' and exists(select 1 from public.course_source_fragments f join public.course_source_documents d on d.id=f.document_id
    where f.artifact_id=snapshot.artifact_id and d.status='READY' and not exists(select 1 from jsonb_array_elements(snapshot.manifest) i where i->>'id'=f.id::text)) then return false; end if;
  return true;
end $$;

create or replace function public.assert_course_source_publication(p_artifact uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare mode text; org uuid;
begin
  if not exists(select 1 from public.course_source_settings where artifact_id=p_artifact and policy is distinct from 'WEB_ONLY') then return; end if;
  select organization_id into org from public.course_source_settings where artifact_id=p_artifact;
  perform public.course_source_all_material_context(p_artifact,org,null);
  if exists(select 1 from public.artifacts a where a.id=p_artifact and (coalesce((a.generation_metadata->>'source_configuration_dirty')::boolean,false)
    or not public.course_source_receipt_valid(a.source_evidence_id,a.id,'BASE',jsonb_build_object('nombres',to_jsonb(a)->'nombres','objetivos',to_jsonb(a)->'objetivos','descripcion',to_jsonb(a)->'descripcion'))))
    or exists(select 1 from public.syllabus s where s.artifact_id=p_artifact and (s.upstream_dirty or not public.course_source_receipt_valid(s.source_evidence_id,s.artifact_id,'SYLLABUS',s.modules))) then raise exception 'SOURCE_UPSTREAM_REVIEW_REQUIRED'; end if;
  if to_regclass('public.course_delivery_workspaces') is not null then
    execute 'select document#>>''{config,mode}'' from public.course_delivery_workspaces where artifact_id=$1' into mode using p_artifact;
  end if;
  if mode is distinct from 'SYNCHRONOUS' and exists(select 1 from public.instructional_plans p where p.artifact_id=p_artifact and jsonb_array_length(p.lesson_plans)>0
    and (p.upstream_dirty or not public.course_source_receipt_valid(p.source_evidence_id,p.artifact_id,'PLAN',p.lesson_plans))) then raise exception 'SOURCE_UPSTREAM_REVIEW_REQUIRED'; end if;
  if mode in ('SYNCHRONOUS','HYBRID') then
    perform public.assert_course_source_delivery(p_artifact,'MATERIALS');
    if mode='SYNCHRONOUS' then return; end if;
  end if;
  if not exists(select 1 from public.material_components c join public.material_lessons l on l.id=c.material_lesson_id join public.materials m on m.id=l.materials_id where m.artifact_id=p_artifact)
    or exists(select 1 from public.material_components c join public.material_lessons l on l.id=c.material_lesson_id join public.materials m on m.id=l.materials_id
      where m.artifact_id=p_artifact and not public.course_source_receipt_valid((c.assets->>'course_source_evidence_id')::uuid,p_artifact,'MATERIALS',c.content,l.lesson_id)) then raise exception 'SOURCE_GENERATION_STALE'; end if;
end $$;

create or replace function public.guard_course_source_material_generation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings;
begin
  select * into settings from public.course_source_settings where artifact_id=new.artifact_id;
  if not found or settings.policy='WEB_ONLY' then return new; end if;
  if new.state in ('PHASE3_GENERATING','PHASE3_APPROVED') then perform public.course_source_all_material_context(new.artifact_id,settings.organization_id,null); end if;
  if new.state='PHASE3_APPROVED' then perform public.assert_course_source_publication(new.artifact_id); end if;
  return new;
end $$;

create or replace function public.guard_course_source_curation_approval() returns trigger
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings;
begin
  select * into settings from public.course_source_settings where artifact_id=new.artifact_id;
  if new.state='PHASE2_APPROVED' and found and settings.policy is distinct from 'WEB_ONLY' then
    perform public.course_source_all_material_context(new.artifact_id,settings.organization_id,null);
    select coalesce((to_jsonb(s)->>'content_version')::integer,0) into new.syllabus_content_version from public.syllabus s where artifact_id=new.artifact_id;
    new.syllabus_content_version:=coalesce(new.syllabus_content_version,0);
  end if;
  return new;
end $$;

create or replace function public.accept_all_course_source_materials(p_artifact uuid,p_organization uuid,p_actor uuid,p_revision integer,p_curriculum text) returns void
language plpgsql security invoker set search_path='' as $$
declare context jsonb; current public.curation; ready boolean;
begin
  perform 1 from public.course_source_settings s join public.artifacts a on a.id=s.artifact_id and a.organization_id=s.organization_id
    where s.artifact_id=p_artifact and s.organization_id=p_organization for update of s;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  context:=public.course_source_all_material_context(p_artifact,p_organization,null);
  if (context->>'revision')::integer<>p_revision or context->>'fingerprint' is distinct from p_curriculum then raise exception 'SOURCE_CONFLICT'; end if;
  ready:=public.course_source_curriculum(p_artifact)->>'planState'='STEP_APPROVED';
  if not coalesce(ready,false) and to_regclass('public.course_delivery_workspaces') is not null then
    execute 'select coalesce(document->''planApproval''<>''null''::jsonb,false) from public.course_delivery_workspaces where artifact_id=$1' into ready using p_artifact;
  end if;
  if not coalesce(ready,false) then raise exception 'SOURCE_PLAN_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=p_actor) then raise exception 'SOURCE_NOT_FOUND'; end if;
  select * into current from public.curation where artifact_id=p_artifact for update;
  if found and current.state in ('PHASE2_GENERATING','PHASE2_VALIDATING','PAUSED_REQUESTED','STOPPED_REQUESTED') then raise exception 'SOURCE_GENERATION_RUNNING'; end if;
  insert into public.curation(artifact_id,state,attempt_number,qa_decision)
    values(p_artifact,'PHASE2_APPROVED',1,jsonb_build_object('decision','APPROVED','reviewed_by','system:all-validated','reviewed_at',now(),
      'notes','Conjunto de fuentes disponibles habilitado automáticamente; cada material debe superar la validación de respaldo y citas.'))
    on conflict(artifact_id) do update set state=excluded.state,qa_decision=excluded.qa_decision;
  -- Reconciliar solo contenido cuyo recibo sigue siendo válido; no aprobar revisiones humanas.
  update public.artifacts a set generation_metadata=coalesce(a.generation_metadata,'{}')-'source_configuration_dirty'
    where a.id=p_artifact and public.course_source_receipt_valid(a.source_evidence_id,a.id,'BASE',jsonb_build_object('nombres',to_jsonb(a)->'nombres','objetivos',to_jsonb(a)->'objetivos','descripcion',to_jsonb(a)->'descripcion'));
  update public.syllabus s set upstream_dirty=false,upstream_dirty_source=null where s.artifact_id=p_artifact and public.course_source_receipt_valid(s.source_evidence_id,s.artifact_id,'SYLLABUS',s.modules);
  update public.instructional_plans p set upstream_dirty=false,upstream_dirty_source=null where p.artifact_id=p_artifact and public.course_source_receipt_valid(p.source_evidence_id,p.artifact_id,'PLAN',p.lesson_plans);
end $$;

create or replace function public.commit_course_source_curation_progress(p_curation_id uuid,p_attempt integer,p_revision integer,
  p_curriculum text,p_rows jsonb,p_completion jsonb default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare artifact uuid; settings public.course_source_settings;
begin
  select artifact_id into artifact from public.curation where id=p_curation_id;
  select * into settings from public.course_source_settings where artifact_id=artifact for update;
  if not found or settings.revision is distinct from p_revision or public.course_source_curriculum(artifact)->>'hash' is distinct from p_curriculum then return false; end if;
  -- La conclusión usa fuentes validadas, no una aprobación humana por objetivo.
  if p_completion->>'state'='PHASE2_APPROVED' then perform public.course_source_all_material_context(artifact,settings.organization_id,null); end if;
  return public.commit_curation_progress(p_curation_id,p_attempt,p_rows,p_completion);
end $$;

create or replace function public.read_course_source_delivery_evidence(p_artifact uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings; context jsonb; sources jsonb;
begin
  select * into settings from public.course_source_settings where artifact_id=p_artifact;
  if not found or settings.policy='WEB_ONLY' then return null; end if;
  context:=public.course_source_all_material_context(p_artifact,settings.organization_id,null);
  -- El contexto de autoría solo necesita identidades y huellas. El worker carga
  -- los textos completos desde el snapshot, sin multiplicarlos por lección aquí.
  if (select coalesce(sum(jsonb_array_length(i->'lessonIds')),0) from jsonb_array_elements(context->'sources') i)>10000 then raise exception 'SOURCE_CONTEXT_BUDGET'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i->>'id','lessonId',lesson,'reference',coalesce(i->>'url','document:'||(i->>'id')),
    'title',i->>'title','rationale','Fuente del conjunto completo','evidence',jsonb_build_object('content_sha256',i->>'hash','locator',i->'locator'),'notes',null)),'[]') into sources
    from jsonb_array_elements(context->'sources') i,jsonb_array_elements_text(i->'lessonIds') lesson;
  return jsonb_build_object('revision',settings.revision,'policy',settings.policy,'sources',sources);
exception when raise_exception then
  if sqlerrm in ('SOURCE_SET_INCOMPLETE','SOURCE_CONFLICT') then return jsonb_build_object('revision',settings.revision,'policy',settings.policy,'sources','[]'::jsonb); end if;
  raise;
end $$;

revoke all on function public.course_source_all_material_context(uuid,uuid,text[]),public.snapshot_all_course_source_materials(uuid,uuid,uuid,text[]),
  public.accept_all_course_source_materials(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.course_source_all_material_context(uuid,uuid,text[]),public.snapshot_all_course_source_materials(uuid,uuid,uuid,text[]),
  public.accept_all_course_source_materials(uuid,uuid,uuid,integer,text) to service_role;
-- Los permisos de funciones sustituidas se conservan: invoker y service_role, sin cambios de RLS.
commit;
