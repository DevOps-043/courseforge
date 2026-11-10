begin;

-- La evidencia de Base y la configuración del curso forman un ciclo de FKs.
-- Solo el borrado confirmado difiere esta comprobación hasta eliminar el curso.
alter table public.artifacts alter constraint artifacts_source_evidence_id_fkey deferrable initially immediate;

create table public.artifact_source_storage_cleanup (
  storage_path text primary key,
  next_attempt_at timestamptz not null
);
create index artifact_source_storage_cleanup_due on public.artifact_source_storage_cleanup(next_attempt_at, storage_path);
alter table public.artifact_source_storage_cleanup enable row level security;
revoke all on public.artifact_source_storage_cleanup from public, anon, authenticated, service_role;
grant select, update (next_attempt_at), delete on public.artifact_source_storage_cleanup to service_role;

create function public.preview_artifact_deletion(p_artifact_id uuid, p_organization_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'documents', manifest.documents,
    'confirmation', encode(sha256(convert_to(jsonb_build_array(a.id, a.organization_id, manifest.documents)::text, 'UTF8')), 'hex')
  )
  from public.artifacts a
  cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(d) order by d.kind, d.id), '[]'::jsonb) as documents
    from (
      select id, filename, status, 'original'::text as kind
      from public.course_source_documents
      where artifact_id = a.id and organization_id = a.organization_id
      union all
      select id, filename, 'REGISTRADO', 'temario'
      from public.syllabus_source_documents where artifact_id = a.id
    ) d
  ) manifest
  where a.id = p_artifact_id and a.organization_id = p_organization_id;
$$;

create function public.confirm_artifact_deletion(p_artifact_id uuid, p_organization_id uuid, p_confirmation text)
returns text language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$
declare
  deletion_result text;
begin
  perform 1 from public.artifacts where id = p_artifact_id and organization_id = p_organization_id for update nowait;
  if not found then return 'NOT_FOUND'; end if;

  -- Las inserciones de fuentes necesitan las filas padre. Los cambios de estado
  -- de documentos ya registrados requieren sus propias filas.
  perform 1 from public.course_source_settings where artifact_id = p_artifact_id for update nowait;
  if exists (select 1 from public.course_source_settings where artifact_id = p_artifact_id
      and organization_id is distinct from p_organization_id) then
    return 'NOT_FOUND';
  end if;
  perform 1 from public.course_source_documents where artifact_id = p_artifact_id for update nowait;
  perform 1 from public.syllabus_source_documents where artifact_id = p_artifact_id for update nowait;

  if p_confirmation is null or p_confirmation is distinct from
    (public.preview_artifact_deletion(p_artifact_id, p_organization_id)->>'confirmation') then
    return 'MANIFEST_CHANGED';
  end if;

  -- La firma puede emitirse hasta el vencimiento de la reserva. Dura dos horas;
  -- se añade una hora para solicitudes de firma y transferencias en curso.
  insert into public.artifact_source_storage_cleanup (storage_path, next_attempt_at)
    select storage_path, greatest(now(), expires_at + interval '3 hours') from public.course_source_documents
    where artifact_id = p_artifact_id and organization_id = p_organization_id;

  set constraints public.artifacts_source_evidence_id_fkey deferred;
  delete from public.syllabus where artifact_id = p_artifact_id;
  delete from public.instructional_plans where artifact_id = p_artifact_id;
  delete from public.syllabus_imports where artifact_id = p_artifact_id;
  delete from public.syllabus_source_documents where artifact_id = p_artifact_id;
  delete from public.course_source_delivery_receipts where artifact_id = p_artifact_id;
  delete from public.course_source_generation_receipts where artifact_id = p_artifact_id;
  delete from public.course_source_snapshot_items where artifact_id = p_artifact_id;
  delete from public.course_source_snapshots where artifact_id = p_artifact_id;
  delete from public.course_source_review_approvals where artifact_id = p_artifact_id;
  delete from public.course_source_review_versions where artifact_id = p_artifact_id;
  delete from public.course_source_policy_changes where artifact_id = p_artifact_id;
  delete from public.course_source_assignments where artifact_id = p_artifact_id;
  delete from public.course_source_fragments where artifact_id = p_artifact_id;
  delete from public.course_source_legacy_imports where artifact_id = p_artifact_id;
  delete from public.course_source_upload_reconciliation where document_id in
    (select id from public.course_source_documents where artifact_id = p_artifact_id);
  delete from public.course_source_extraction_batches where document_id in
    (select id from public.course_source_documents where artifact_id = p_artifact_id);
  delete from public.course_source_documents where artifact_id = p_artifact_id;

  deletion_result := public.delete_artifact_for_organization(p_artifact_id, p_organization_id);
  if deletion_result <> 'DELETED' then raise exception 'No se confirmó la eliminación del artefacto.'; end if;
  set constraints public.artifacts_source_evidence_id_fkey immediate;
  return deletion_result;
end;
$$;

revoke all on function public.preview_artifact_deletion(uuid, uuid), public.confirm_artifact_deletion(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.preview_artifact_deletion(uuid, uuid), public.confirm_artifact_deletion(uuid, uuid, text) to service_role;

commit;
