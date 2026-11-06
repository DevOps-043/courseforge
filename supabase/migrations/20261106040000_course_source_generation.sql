begin;
alter table public.course_source_snapshots add column input_fingerprint text, add column lesson_id text,
  add column manifest jsonb not null default '[]' check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest)<=1000);
create table public.course_source_generation_receipts (
  id uuid primary key default gen_random_uuid(), artifact_id uuid not null,
  snapshot_id uuid not null, output_hash text not null check(length(output_hash)=32),
  citations jsonb not null check(jsonb_typeof(citations)='array' and jsonb_array_length(citations) between 1 and 100),
  created_at timestamptz not null default now(),
  foreign key(artifact_id,snapshot_id) references public.course_source_snapshots(artifact_id,id)
);
create index course_source_generation_receipts_snapshot on public.course_source_generation_receipts(snapshot_id);
alter table public.course_source_generation_receipts enable row level security;
revoke all on public.course_source_generation_receipts from public,anon,authenticated;
grant select,insert on public.course_source_generation_receipts to service_role;
alter table public.artifacts add column source_evidence_id uuid references public.course_source_generation_receipts(id);
alter table public.syllabus add column source_evidence_id uuid references public.course_source_generation_receipts(id);
alter table public.instructional_plans add column source_evidence_id uuid references public.course_source_generation_receipts(id);
create table public.course_source_delivery_receipts (
  receipt_id uuid primary key references public.course_source_generation_receipts(id),
  artifact_id uuid not null references public.course_source_settings(artifact_id), run_id uuid not null,
  unit_id text not null, operation text not null check(operation in ('AGENDA','PLAN','MATERIALS'))
);
create index course_source_delivery_receipts_course on public.course_source_delivery_receipts(artifact_id,operation,unit_id);
create table public.course_source_legacy_imports (
  artifact_id uuid not null, document_id uuid not null, origin_kind text not null check(origin_kind in ('SYLLABUS_DOCUMENT','CURATION_PDF')),
  origin_id uuid not null, origin_hash text, original_available boolean not null,
  primary key(artifact_id,origin_kind,origin_id), foreign key(artifact_id,document_id) references public.course_source_documents(artifact_id,id)
);
alter table public.course_source_legacy_imports enable row level security;
revoke all on public.course_source_legacy_imports from public,anon,authenticated;
grant select,insert on public.course_source_legacy_imports to service_role;
alter table public.course_source_delivery_receipts enable row level security;
revoke all on public.course_source_delivery_receipts from public,anon,authenticated;
grant select,insert on public.course_source_delivery_receipts to service_role;

create or replace function public.course_source_curriculum(p_artifact uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare modules jsonb; plans jsonb; delivery jsonb; plan_state text; syllabus_version text; base jsonb;
begin
  select s.modules,to_jsonb(s)->>'content_version' into modules,syllabus_version from public.syllabus s where artifact_id=p_artifact;
  select p.lesson_plans,p.state into plans,plan_state from public.instructional_plans p where artifact_id=p_artifact;
  select jsonb_build_object('objetivos',to_jsonb(a)->'objetivos','idea',a.idea_central) into base from public.artifacts a where id=p_artifact;
  if to_regclass('public.course_delivery_workspaces') is not null then
    execute 'select document from public.course_delivery_workspaces where artifact_id=$1' into delivery using p_artifact;
    if delivery is not null then delivery:=jsonb_build_object('config',delivery->'config','agenda',delivery->'agenda','plans',delivery->'plans','planApproval',delivery->'planApproval'); end if;
  end if;
  return jsonb_build_object('modules',coalesce(modules,'[]'),'plans',coalesce(plans,'[]'),'planState',plan_state,'base',base,'syllabusVersion',coalesce(syllabus_version,'0'),
    'hash',md5(coalesce(modules::text,'[]')||coalesce(plans::text,'[]')||coalesce(plan_state,'')||coalesce(delivery::text,'{}')||coalesce(syllabus_version,'0')||coalesce(base::text,'{}')));
end $$;

create function public.course_source_generation_fingerprint(p_artifact uuid,p_stage text) returns text
language plpgsql security invoker set search_path='' as $$
declare payload jsonb;
begin
  if p_stage='BASE' then return md5('BASE');
  elsif p_stage='SYLLABUS' then select jsonb_build_object('objetivos',to_jsonb(a)->'objetivos','idea',a.idea_central) into payload from public.artifacts a where id=p_artifact;
  elsif p_stage='PLAN' then select jsonb_build_object('modules',modules,'version',to_jsonb(s)->'content_version') into payload from public.syllabus s where artifact_id=p_artifact;
  elsif p_stage='MATERIALS' then return public.course_source_curriculum(p_artifact)->>'hash';
  else raise exception 'SOURCE_CONFLICT'; end if;
  return md5(coalesce(payload::text,'{}'));
end $$;

create function public.course_source_snapshot_current(p_snapshot uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare snapshot public.course_source_snapshots; settings public.course_source_settings; item jsonb; current_text text;
begin
  select * into snapshot from public.course_source_snapshots where id=p_snapshot;
  if not found or snapshot.input_fingerprint is null then return false; end if;
  select * into settings from public.course_source_settings where artifact_id=snapshot.artifact_id;
  if not found or settings.policy is distinct from snapshot.policy or snapshot.input_fingerprint is distinct from public.course_source_generation_fingerprint(snapshot.artifact_id,snapshot.stage) then return false; end if;
  if not exists(select 1 from public.artifacts where id=snapshot.artifact_id and organization_id=settings.organization_id) then return false; end if;
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

create function public.snapshot_course_source_generation(p_artifact uuid,p_organization uuid,p_execution uuid,p_stage text,
  p_revision integer,p_fingerprint text,p_lesson text,p_context_hash text,p_manifest jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings; snapshot uuid; existing public.course_source_snapshots; item jsonb; fragment public.course_source_fragments; review jsonb; chars integer:=0;
begin
  perform 1 from public.artifacts where id=p_artifact and organization_id=p_organization;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  select * into settings from public.course_source_settings where artifact_id=p_artifact and organization_id=p_organization for update;
  if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  if settings.policy is null or settings.policy='WEB_ONLY' or settings.revision is distinct from p_revision
    or p_fingerprint is distinct from public.course_source_generation_fingerprint(p_artifact,p_stage)
    or jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 1000 then raise exception 'SOURCE_CONFLICT'; end if;
  if p_stage='MATERIALS' then
    select v.associations into review from public.course_source_review_versions v join public.course_source_review_approvals a using(artifact_id,revision)
      where v.artifact_id=p_artifact and v.revision=settings.revision and a.curriculum_hash=p_fingerprint and settings.approved_revision=settings.revision;
    if not found then raise exception 'SOURCE_REVIEW_REQUIRED'; end if;
  end if;
  for item in select value from jsonb_array_elements(p_manifest) loop
    if item->>'kind'='DOCUMENT' then
      select f.* into fragment from public.course_source_fragments f join public.course_source_documents d on d.id=f.document_id
        where f.id=(item->>'id')::uuid and f.artifact_id=p_artifact and d.status='READY'
        and f.document_id=(item->>'documentId')::uuid and f.content_sha256=item->>'hash' and f.locator=item->'locator' and d.filename=item->>'title';
      if not found then raise exception 'SOURCE_CONFLICT'; end if;
      chars:=chars+length(fragment.text_content);
    elsif item->>'kind'='WEB' and settings.policy='DOCUMENTS_AND_WEB' and p_stage='MATERIALS' then
      perform 1 from public.curation_rows r join public.curation c on c.id=r.curation_id where r.id=(item->>'id')::uuid and c.artifact_id=p_artifact
        and r.apta=true and coalesce(r.validation_report->>'status','valid')='valid' and (p_lesson is null or r.lesson_id=p_lesson)
        and r.validation_report->>'content_excerpt'=item->>'text' and r.source_ref=item->>'url'
        and encode(sha256(convert_to(item->>'text','UTF8')),'hex')=item->>'hash';
      if not found then raise exception 'SOURCE_CONFLICT'; end if;
      chars:=chars+length(item->>'text');
    else raise exception 'SOURCE_CONFLICT'; end if;
    if p_stage='MATERIALS' and not exists(select 1 from jsonb_array_elements(review) a where a->>'evidenceId'=item->>'id'
      and (p_lesson is null or a->>'lessonId'=p_lesson) and (a->>'verified')::boolean and (not (a->>'conflict')::boolean or length(btrim(a->>'resolution'))>0)) then raise exception 'SOURCE_REVIEW_REQUIRED'; end if;
  end loop;
  if chars>(case when p_stage='MATERIALS' then 60000 else 120000 end) then raise exception 'SOURCE_CONTEXT_BUDGET'; end if;
  select * into existing from public.course_source_snapshots where artifact_id=p_artifact and execution_id=p_execution and stage=p_stage;
  if found then
    if existing.source_revision is distinct from p_revision or existing.input_fingerprint is distinct from p_fingerprint or existing.lesson_id is distinct from p_lesson
      or existing.context_sha256 is distinct from p_context_hash or existing.manifest is distinct from p_manifest or not public.course_source_snapshot_current(existing.id) then raise exception 'SOURCE_CONFLICT'; end if;
    return existing.id;
  end if;
  insert into public.course_source_snapshots(artifact_id,execution_id,stage,policy,source_revision,syllabus_content_version,context_sha256,input_fingerprint,lesson_id,manifest)
    values(p_artifact,p_execution,p_stage,settings.policy,p_revision,coalesce((select (to_jsonb(s)->>'content_version')::integer from public.syllabus s where artifact_id=p_artifact),0),p_context_hash,p_fingerprint,p_lesson,p_manifest) returning id into snapshot;
  insert into public.course_source_snapshot_items(artifact_id,snapshot_id,document_id,fragment_id,ordinal)
    select p_artifact,snapshot,(i->>'documentId')::uuid,(i->>'id')::uuid,(ordinality-1)::integer from jsonb_array_elements(p_manifest) with ordinality items(i,ordinality) where i->>'kind'='DOCUMENT';
  if not public.course_source_snapshot_current(snapshot) then raise exception 'SOURCE_CONFLICT'; end if;
  return snapshot;
end $$;

create function public.attest_course_source_generation(p_snapshot uuid,p_output jsonb,p_citations jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare receipt uuid; snapshot public.course_source_snapshots; citation jsonb; text_content text;
begin
  select * into snapshot from public.course_source_snapshots where id=p_snapshot;
  perform 1 from public.course_source_settings where artifact_id=snapshot.artifact_id for update;
  if not public.course_source_snapshot_current(p_snapshot) then raise exception 'SOURCE_CONFLICT'; end if;
  if jsonb_typeof(p_citations) is distinct from 'array' or jsonb_array_length(p_citations) not between 1 and 100 then raise exception 'SOURCE_CONFLICT'; end if;
  for citation in select value from jsonb_array_elements(p_citations) loop
    select case when i->>'kind'='WEB' then i->>'text' else (select f.text_content from public.course_source_fragments f where f.id=(i->>'id')::uuid) end
      into text_content from jsonb_array_elements(snapshot.manifest) i where i->>'id'=citation->>'sourceId';
    if text_content is null or citation->>'quote' is null or length(citation->>'quote') not between 16 and 2000 or position(citation->>'quote' in text_content)=0
      or citation->>'claim' is null or length(citation->>'claim') not between 8 and 2000
      or not exists(select 1 from jsonb_path_query(p_output,'$.** ? (@.type() == "string")') v where position(citation->>'claim' in v#>>'{}')>0) then raise exception 'SOURCE_CITATION_INVALID'; end if;
  end loop;
  insert into public.course_source_generation_receipts(artifact_id,snapshot_id,output_hash,citations) values(snapshot.artifact_id,p_snapshot,md5(p_output::text),p_citations) returning id into receipt;
  return receipt;
end $$;

create function public.course_source_receipt_valid(p_receipt uuid,p_artifact uuid,p_stage text,p_output jsonb,p_lesson text default null) returns boolean
language sql security invoker set search_path='' as $$
  select exists(select 1 from public.course_source_generation_receipts r join public.course_source_snapshots s on s.id=r.snapshot_id
    where r.id=p_receipt and r.artifact_id=p_artifact and s.stage=p_stage and r.output_hash=md5(p_output::text)
      and (p_lesson is null or s.lesson_id=regexp_replace(p_lesson,'-G[0-9]+$','','i')) and public.course_source_snapshot_current(s.id));
$$;

-- Sustituye las guardas temporales F3: admite iniciar con fuentes READY, exige recibo al guardar resultados.
create or replace function public.guard_course_source_structure_generation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare artifact uuid; stage text; output jsonb; settings public.course_source_settings; changed boolean;
begin
  if tg_table_name='artifacts' then artifact:=new.id; stage:='BASE'; output:=jsonb_build_object('nombres',to_jsonb(new)->'nombres','objetivos',to_jsonb(new)->'objetivos','descripcion',to_jsonb(new)->'descripcion');
  elsif tg_table_name='syllabus' then artifact:=new.artifact_id; stage:='SYLLABUS'; output:=to_jsonb(new)->'modules';
    if to_jsonb(new)#>>'{source_summary,course_source_evidence_id}' is not null then new.source_evidence_id:=(to_jsonb(new)#>>'{source_summary,course_source_evidence_id}')::uuid; end if;
  else artifact:=new.artifact_id; stage:='PLAN'; output:=to_jsonb(new)->'lesson_plans'; end if;
  select * into settings from public.course_source_settings where artifact_id=artifact;
  if not found or settings.policy='WEB_ONLY' then return new; end if;
  -- Un fallo terminal no aprueba contenido ni puede sustituir la salida anterior.
  if stage='BASE' and tg_op='UPDATE' then
    if new.state::text='ESCALATED'
      and coalesce(to_jsonb(new)->'validation_report','{}'::jsonb) @> '{"all_passed":false,"results":[{"code":"GENERATION_FAILED","passed":false}]}'::jsonb
      and new.source_evidence_id is not distinct from old.source_evidence_id
      and output=jsonb_build_object('nombres',to_jsonb(old)->'nombres','objetivos',to_jsonb(old)->'objetivos','descripcion',to_jsonb(old)->'descripcion') then
      return new;
    end if;
  end if;
  if new.state::text in ('GENERATING','STEP_GENERATING','STEP_PROCESSING') then
    if settings.policy is null or not exists(select 1 from public.course_source_documents where artifact_id=artifact and status='READY') then raise exception 'SOURCE_REVIEW_REQUIRED'; end if;
  end if;
  changed:=tg_op='INSERT';
  if tg_op='UPDATE' then changed:=new.state is distinct from old.state or new.source_evidence_id is distinct from old.source_evidence_id;
    if stage='BASE' then changed:=changed or (to_jsonb(new)->'objetivos') is distinct from (to_jsonb(old)->'objetivos') or (to_jsonb(new)->'nombres') is distinct from (to_jsonb(old)->'nombres') or (to_jsonb(new)->'descripcion') is distinct from (to_jsonb(old)->'descripcion');
    elsif stage='SYLLABUS' then changed:=changed or new.modules is distinct from old.modules;
    else changed:=changed or new.lesson_plans is distinct from old.lesson_plans; end if;
  end if;
  if changed and new.state::text in ('APPROVED','STEP_APPROVED','STEP_READY_FOR_QA','STEP_READY_FOR_REVIEW','STEP_WITH_BLOCKERS','ESCALATED')
    and not public.course_source_receipt_valid(new.source_evidence_id,artifact,stage,output) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  return new;
end $$;

create or replace function public.guard_course_source_material_generation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings;
begin
  select * into settings from public.course_source_settings where artifact_id=new.artifact_id;
  if not found or settings.policy='WEB_ONLY' then return new; end if;
  if new.state in ('PHASE3_GENERATING','PHASE3_APPROVED') and (settings.policy is null or settings.approved_revision is distinct from settings.revision
    or not exists(select 1 from public.course_source_review_approvals where artifact_id=new.artifact_id and revision=settings.revision and curriculum_hash=public.course_source_curriculum(new.artifact_id)->>'hash')) then raise exception 'SOURCE_REVIEW_REQUIRED'; end if;
  if new.state='PHASE3_APPROVED' then perform public.assert_course_source_publication(new.artifact_id); end if;
  return new;
end $$;

create or replace function public.guard_course_source_curation_approval() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.state='PHASE2_APPROVED' and exists(select 1 from public.course_source_settings where artifact_id=new.artifact_id and policy is distinct from 'WEB_ONLY') then
    if exists(select 1 from public.course_source_settings s where s.artifact_id=new.artifact_id and (s.approved_revision is distinct from s.revision
      or not exists(select 1 from public.course_source_review_approvals a where a.artifact_id=s.artifact_id and a.revision=s.revision and a.curriculum_hash=public.course_source_curriculum(s.artifact_id)->>'hash'))) then raise exception 'SOURCE_REVIEW_REQUIRED'; end if;
    -- La curación documental también conserva el contrato previo de temarios importados.
    select coalesce((to_jsonb(s)->>'content_version')::integer,0) into new.syllabus_content_version from public.syllabus s where artifact_id=new.artifact_id;
    new.syllabus_content_version:=coalesce(new.syllabus_content_version,0);
  end if;
  return new;
end $$;

create function public.guard_course_source_component() returns trigger
language plpgsql security invoker set search_path='' as $$
declare artifact uuid; lesson text;
begin
  select m.artifact_id,l.lesson_id into artifact,lesson from public.material_lessons l join public.materials m on m.id=l.materials_id where l.id=new.material_lesson_id;
  if exists(select 1 from public.course_source_settings where artifact_id=artifact and policy is distinct from 'WEB_ONLY')
    and (tg_op='INSERT' or new.content is distinct from old.content or new.assets->>'course_source_evidence_id' is distinct from old.assets->>'course_source_evidence_id')
    and not public.course_source_receipt_valid((new.assets->>'course_source_evidence_id')::uuid,artifact,'MATERIALS',new.content,lesson) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  return new;
end $$;
create trigger course_source_component before insert or update on public.material_components for each row execute function public.guard_course_source_component();

create function public.current_course_source_component_ids(p_artifact uuid) returns uuid[]
language sql security invoker set search_path='' as $$
  select coalesce(array_agg(c.id),'{}'::uuid[]) from public.material_components c join public.material_lessons l on l.id=c.material_lesson_id join public.materials m on m.id=l.materials_id
    where m.artifact_id=p_artifact and public.course_source_receipt_valid((c.assets->>'course_source_evidence_id')::uuid,p_artifact,'MATERIALS',c.content,l.lesson_id);
$$;

create function public.assert_course_source_publication(p_artifact uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare mode text;
begin
  if not exists(select 1 from public.course_source_settings where artifact_id=p_artifact and policy is distinct from 'WEB_ONLY') then return; end if;
  if not exists(select 1 from public.course_source_settings s join public.course_source_review_approvals a on a.artifact_id=s.artifact_id and a.revision=s.revision
    where s.artifact_id=p_artifact and s.approved_revision=s.revision and a.curriculum_hash=public.course_source_curriculum(p_artifact)->>'hash') then raise exception 'SOURCE_REVIEW_REQUIRED'; end if;
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

create function public.read_course_source_delivery_evidence(p_artifact uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings; associations jsonb; sources jsonb;
begin
  select * into settings from public.course_source_settings where artifact_id=p_artifact;
  if not found or settings.policy='WEB_ONLY' then return null; end if;
  select v.associations into associations from public.course_source_review_versions v join public.course_source_review_approvals a using(artifact_id,revision)
    where v.artifact_id=p_artifact and v.revision=settings.revision and settings.approved_revision=settings.revision and a.curriculum_hash=public.course_source_curriculum(p_artifact)->>'hash';
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'lessonId',i->>'lessonId','reference','document:'||f.id,'title',d.filename,'rationale','Documento aprobado',
    'evidence',jsonb_build_object('content_excerpt',f.text_content,'locator',f.locator),'notes',null)),'[]') into sources
    from jsonb_array_elements(coalesce(associations,'[]')) i join public.course_source_fragments f on f.id=(i->>'evidenceId')::uuid and f.artifact_id=p_artifact
    join public.course_source_documents d on d.id=f.document_id and d.status='READY' where i->>'evidenceType'='DOCUMENT';
  if settings.policy='DOCUMENTS_AND_WEB' then
    select sources||coalesce(jsonb_agg(jsonb_build_object('id',r.id,'lessonId',r.lesson_id,'reference',r.source_ref,'title',to_jsonb(r)->>'source_title',
      'rationale','URL aprobada','evidence',r.validation_report,'notes',null)),'[]') into sources
      from jsonb_array_elements(coalesce(associations,'[]')) i join public.curation_rows r on r.id=(i->>'evidenceId')::uuid
      join public.curation c on c.id=r.curation_id and c.artifact_id=p_artifact where i->>'evidenceType'='WEB' and r.apta=true and r.lesson_id=i->>'lessonId';
  end if;
  return jsonb_build_object('revision',settings.revision,'policy',settings.policy,'sources',sources);
end $$;

create function public.commit_course_source_delivery_unit(p_run_id uuid,p_token uuid,p_document jsonb,p_units jsonb,p_receipt uuid,p_unit text) returns integer
language plpgsql security invoker set search_path='' as $$
declare run jsonb; output jsonb; revision integer;
begin
  execute 'select to_jsonb(r) from public.course_delivery_runs r where id=$1' into run using p_run_id;
  perform 1 from public.course_source_settings where artifact_id=(run->>'artifact_id')::uuid for update;
  output:=case run->>'operation' when 'AGENDA' then p_document->'agenda' when 'PLAN' then p_document->'plans'->p_unit else p_document->'materials'->p_unit end;
  if not public.course_source_receipt_valid(p_receipt,(run->>'artifact_id')::uuid,case when run->>'operation'='MATERIALS' then 'MATERIALS' else 'PLAN' end,output) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  execute 'select public.commit_course_delivery_unit($1,$2,$3,$4)' into revision using p_run_id,p_token,p_document,p_units;
  insert into public.course_source_delivery_receipts values(p_receipt,(run->>'artifact_id')::uuid,p_run_id,p_unit,run->>'operation');
  return revision;
end $$;

create function public.assert_course_source_delivery(p_artifact uuid,p_phase text) returns void
language plpgsql security invoker set search_path='' as $$
declare document jsonb; session jsonb; output jsonb;
begin
  execute 'select document from public.course_delivery_workspaces where artifact_id=$1' into document using p_artifact;
  if jsonb_array_length(coalesce(document->'agenda','[]'))=0 then raise exception 'SOURCE_GENERATION_STALE'; end if;
  for session in select value from jsonb_array_elements(document->'agenda') loop
    output:=case when p_phase='PLAN' then document->'plans'->(session->>'id') else document->'materials'->(session->>'id') end;
    if not exists(select 1 from public.course_source_delivery_receipts r where r.artifact_id=p_artifact and r.unit_id=session->>'id' and r.operation=p_phase
      and public.course_source_receipt_valid(r.receipt_id,p_artifact,case when p_phase='PLAN' then 'PLAN' else 'MATERIALS' end,output)) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  end loop;
end $$;

create function public.guard_course_source_delivery_approval() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.course_source_settings where artifact_id=new.artifact_id and policy is distinct from 'WEB_ONLY') then return new; end if;
  -- El recibo se comprueba sobre NEW; la edición manual sigue siendo un borrador revisable.
  if new.document->'materialsApproval' is distinct from 'null'::jsonb and new.document->'materialsApproval' is not null then
    if exists(select 1 from jsonb_array_elements(new.document->'agenda') s where not exists(select 1 from public.course_source_delivery_receipts r
      where r.artifact_id=new.artifact_id and r.unit_id=s->>'id' and r.operation='MATERIALS'
      and public.course_source_receipt_valid(r.receipt_id,new.artifact_id,'MATERIALS',new.document->'materials'->(s->>'id')))) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  end if;
  if new.document->'planApproval' is distinct from 'null'::jsonb and new.document->'planApproval' is not null then
    if exists(select 1 from jsonb_array_elements(new.document->'agenda') s where not exists(select 1 from public.course_source_delivery_receipts r
      where r.artifact_id=new.artifact_id and r.unit_id=s->>'id' and r.operation='PLAN'
      and public.course_source_receipt_valid(r.receipt_id,new.artifact_id,'PLAN',new.document->'plans'->(s->>'id')))) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.course_delivery_workspaces') is not null then
    execute 'create trigger course_source_delivery_approval before insert or update on public.course_delivery_workspaces for each row execute function public.guard_course_source_delivery_approval()';
  end if;
end $$;

create function public.reconcile_course_source_structure() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.approved_revision=new.revision and new.approved_revision is distinct from old.approved_revision then
    update public.artifacts a set generation_metadata=coalesce(a.generation_metadata,'{}')-'source_configuration_dirty'
      where a.id=new.artifact_id and public.course_source_receipt_valid(a.source_evidence_id,a.id,'BASE',jsonb_build_object('nombres',to_jsonb(a)->'nombres','objetivos',to_jsonb(a)->'objetivos','descripcion',to_jsonb(a)->'descripcion'));
    update public.syllabus s set upstream_dirty=false,upstream_dirty_source=null where s.artifact_id=new.artifact_id and public.course_source_receipt_valid(s.source_evidence_id,s.artifact_id,'SYLLABUS',s.modules);
    update public.instructional_plans p set upstream_dirty=false,upstream_dirty_source=null where p.artifact_id=new.artifact_id and public.course_source_receipt_valid(p.source_evidence_id,p.artifact_id,'PLAN',p.lesson_plans);
  end if;
  return new;
end $$;
create trigger course_source_structure_reconciliation after update on public.course_source_settings for each row execute function public.reconcile_course_source_structure();

create or replace function public.course_source_web_evidence_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare artifact uuid;
begin
  if tg_op='DELETE' then
    select artifact_id into artifact from public.curation where id=old.curation_id;
  elsif new.apta is distinct from old.apta or new.source_ref is distinct from old.source_ref or new.lesson_id is distinct from old.lesson_id
    or to_jsonb(new)->>'source_kind' is distinct from to_jsonb(old)->>'source_kind'
    or new.validation_report->>'status' is distinct from old.validation_report->>'status'
    or new.validation_report->>'content_excerpt' is distinct from old.validation_report->>'content_excerpt' then
    select artifact_id into artifact from public.curation where id=new.curation_id;
  end if;
  if artifact is not null then update public.course_source_settings set revision=revision+1,approved_revision=null where artifact_id=artifact and policy in('DOCUMENTS_ONLY','DOCUMENTS_AND_WEB'); end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger course_source_web_evidence_removal after delete on public.curation_rows for each row execute function public.course_source_web_evidence_revision();

create function public.guard_course_source_production_job() returns trigger
language plpgsql security invoker set search_path='' as $$
declare settings public.course_source_settings; expected jsonb; component_hash text;
begin
  select * into settings from public.course_source_settings where artifact_id=new.artifact_id;
  if not found or settings.policy='WEB_ONLY' then return new; end if;
  if tg_op='UPDATE' and new.input_snapshot->'course_source_version' is distinct from old.input_snapshot->'course_source_version' then raise exception 'SOURCE_GENERATION_STALE'; end if;
  if new.status in ('FAILED','CANCELLED') then return new; end if;
  perform public.assert_course_source_publication(new.artifact_id);
  select md5(content::text) into component_hash from public.material_components where id=new.material_component_id;
  expected:=jsonb_build_object('revision',settings.revision,'fingerprint',public.course_source_generation_fingerprint(new.artifact_id,'MATERIALS'),'component_hash',component_hash);
  if tg_op='INSERT' then new.input_snapshot:=coalesce(new.input_snapshot,'{}')||jsonb_build_object('course_source_version',expected);
  elsif new.input_snapshot->'course_source_version' is distinct from expected then raise exception 'SOURCE_GENERATION_STALE'; end if;
  return new;
end $$;
create function public.guard_course_source_production_asset() returns trigger
language plpgsql security invoker set search_path='' as $$
declare job jsonb; revision integer; component_hash text;
begin
  select s.revision into revision from public.course_source_settings s where artifact_id=new.artifact_id and policy is distinct from 'WEB_ONLY';
  if not found then return new; end if;
  perform public.assert_course_source_publication(new.artifact_id);
  if new.production_job_id is not null then
    execute 'select input_snapshot->''course_source_version'' from public.production_jobs where id=$1 and artifact_id=$2' into job using new.production_job_id,new.artifact_id;
    select md5(content::text) into component_hash from public.material_components where id=new.material_component_id;
    if job is distinct from jsonb_build_object('revision',revision,'fingerprint',public.course_source_generation_fingerprint(new.artifact_id,'MATERIALS'),'component_hash',component_hash) then raise exception 'SOURCE_GENERATION_STALE'; end if;
  end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.production_jobs') is not null then execute 'create trigger course_source_job before insert or update on public.production_jobs for each row execute function public.guard_course_source_production_job()'; end if;
  if to_regclass('public.production_assets') is not null then execute 'create trigger course_source_asset before insert or update on public.production_assets for each row execute function public.guard_course_source_production_asset()'; end if;
end $$;

create function public.guard_course_source_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='artifacts' then
    if new.production_complete then perform public.assert_course_source_publication(new.id); end if;
  elsif new.status in ('READY','SENT','APPROVED') then perform public.assert_course_source_publication(new.artifact_id); end if;
  return new;
end $$;
create trigger course_source_production before update on public.artifacts for each row execute function public.guard_course_source_publication();
create trigger course_source_publication before insert or update on public.publication_requests for each row execute function public.guard_course_source_publication();

revoke all on function public.course_source_generation_fingerprint(uuid,text),public.course_source_snapshot_current(uuid),
  public.snapshot_course_source_generation(uuid,uuid,uuid,text,integer,text,text,text,jsonb),public.attest_course_source_generation(uuid,jsonb,jsonb),
  public.course_source_receipt_valid(uuid,uuid,text,jsonb,text),public.guard_course_source_component(),public.assert_course_source_publication(uuid),public.guard_course_source_publication() from public,anon,authenticated;
grant execute on function public.course_source_generation_fingerprint(uuid,text),public.course_source_snapshot_current(uuid),
  public.snapshot_course_source_generation(uuid,uuid,uuid,text,integer,text,text,text,jsonb),public.attest_course_source_generation(uuid,jsonb,jsonb),
  public.course_source_receipt_valid(uuid,uuid,text,jsonb,text),public.assert_course_source_publication(uuid) to service_role;
revoke all on function public.read_course_source_delivery_evidence(uuid),public.commit_course_source_delivery_unit(uuid,uuid,jsonb,jsonb,uuid,text),public.assert_course_source_delivery(uuid,text) from public,anon,authenticated;
revoke all on function public.guard_course_source_delivery_approval(),public.reconcile_course_source_structure() from public,anon,authenticated;
revoke all on function public.guard_course_source_production_job(),public.guard_course_source_production_asset() from public,anon,authenticated;
revoke all on function public.current_course_source_component_ids(uuid) from public,anon,authenticated;
grant execute on function public.current_course_source_component_ids(uuid) to service_role;
grant execute on function public.read_course_source_delivery_evidence(uuid),public.commit_course_source_delivery_unit(uuid,uuid,jsonb,jsonb,uuid,text),public.assert_course_source_delivery(uuid,text) to service_role;
commit;
