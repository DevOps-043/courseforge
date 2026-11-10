begin;

-- Las políticas históricas FOR ALL no deben habilitar el borrado directo.
revoke delete on table public.artifacts from public, anon, authenticated;

-- Conservar la clave y la cuota del borrador sin poder resucitarlo por un reintento.
alter table public.course_source_drafts alter column artifact_id drop not null;

create or replace function public.create_course_source_draft(p_organization uuid, p_actor uuid, p_key uuid, p_title text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  existing public.course_source_drafts;
  course uuid := gen_random_uuid();
  daily_draft_limit constant integer := 50;
  organization_lock_seed constant integer := 715;
begin
  if p_organization is null or p_actor is null or p_key is null or p_title is null
    or length(btrim(p_title)) not between 1 and 300 then raise exception 'SOURCE_CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text, organization_lock_seed));
  select * into existing from public.course_source_drafts
    where organization_id=p_organization and created_by=p_actor and request_key=p_key;
  if found then
    if existing.artifact_id is null or existing.requested_title <> btrim(p_title) then
      raise exception 'SOURCE_CONFLICT';
    end if;
    return existing.artifact_id;
  end if;
  if (select count(*) from public.course_source_drafts where organization_id=p_organization
      and created_by=p_actor and created_at > now()-interval '24 hours') >= daily_draft_limit then raise exception 'SOURCE_QUOTA'; end if;
  insert into public.artifacts(id, organization_id, created_by, idea_central, course_id, state)
    values(course,p_organization,p_actor,btrim(p_title),'DOC-' || course::text,'DRAFT');
  insert into public.course_source_settings(artifact_id,organization_id) values(course,p_organization);
  insert into public.course_source_drafts(organization_id,created_by,request_key,artifact_id,requested_title)
    values(p_organization,p_actor,p_key,course,btrim(p_title));
  return course;
end $$;

create function public.delete_artifact_for_organization(p_artifact_id uuid, p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
begin
  perform 1 from public.artifacts
    where id = p_artifact_id and organization_id = p_organization_id
    for update nowait;
  if not found then
    return 'NOT_FOUND';
  end if;

  -- Las reservas concurrentes deben obtener un bloqueo FK sobre una de estas filas.
  perform 1 from public.course_source_settings
    where artifact_id = p_artifact_id and organization_id = p_organization_id
    for update nowait;

  if exists (select 1 from public.course_source_documents where artifact_id = p_artifact_id)
    or exists (select 1 from public.syllabus_source_documents where artifact_id = p_artifact_id) then
    return 'HAS_SOURCE_DOCUMENTS';
  end if;

  delete from public.publication_requests where artifact_id = p_artifact_id;
  delete from public.pipeline_events where artifact_id = p_artifact_id;
  delete from public.curation_rows as r using public.curation as c
    where r.curation_id = c.id and c.artifact_id = p_artifact_id;
  if pg_catalog.to_regclass('public.curation_blockers') is not null then
    delete from public.curation_blockers as b using public.curation as c
      where b.curation_id = c.id and c.artifact_id = p_artifact_id;
  end if;
  delete from public.curation where artifact_id = p_artifact_id;

  delete from public.material_components as c using public.material_lessons as l, public.materials as m
    where c.material_lesson_id = l.id and l.materials_id = m.id and m.artifact_id = p_artifact_id;
  delete from public.material_lessons as l using public.materials as m
    where l.materials_id = m.id and m.artifact_id = p_artifact_id;
  delete from public.materials where artifact_id = p_artifact_id;
  delete from public.instructional_plans where artifact_id = p_artifact_id;
  delete from public.syllabus where artifact_id = p_artifact_id;

  update public.course_source_drafts
    set artifact_id = null, requested_title = 'Eliminado'
    where artifact_id = p_artifact_id and organization_id = p_organization_id;
  delete from public.course_source_settings
    where artifact_id = p_artifact_id and organization_id = p_organization_id;
  delete from public.artifacts where id = p_artifact_id and organization_id = p_organization_id;
  if not found then
    raise exception 'No se confirmó la eliminación del artefacto.';
  end if;
  return 'DELETED';
end;
$$;

revoke all on function public.delete_artifact_for_organization(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_artifact_for_organization(uuid, uuid) to service_role;

commit;
