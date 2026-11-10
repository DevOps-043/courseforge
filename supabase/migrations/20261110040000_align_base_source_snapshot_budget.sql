begin;

-- Base prepara el manifiesto completo antes de leer sus lotes. El tope por
-- llamada se aplica en el lector, mientras el snapshot valida el curso completo.
create or replace function public.snapshot_course_source_generation(p_artifact uuid,p_organization uuid,p_execution uuid,p_stage text,
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
      chars:=chars+(case when p_stage='BASE' then public.course_source_utf16_units(fragment.text_content)
        else length(fragment.text_content) end);
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
  if chars>(case when p_stage='BASE' then 1200000 when p_stage='MATERIALS' then 60000 else 120000 end) then raise exception 'SOURCE_CONTEXT_BUDGET'; end if;
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

commit;
