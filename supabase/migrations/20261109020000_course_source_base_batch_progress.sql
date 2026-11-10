begin;

-- Deja disponible un intento para archivos rechazados tres veces con el límite anterior.
update public.course_source_documents set extraction_attempts=2
  where status='FAILED' and diagnostic_code='TEXT_LIMIT' and extraction_attempts=3;

-- Las ejecuciones pertenecen al curso y sus hallazgos contienen texto privado.
alter table public.course_source_batch_runs
  drop constraint course_source_batch_runs_artifact_id_organization_id_fkey,
  add foreign key (artifact_id, organization_id)
    references public.course_source_settings(artifact_id, organization_id) on delete cascade;
alter table public.course_source_batches
  drop constraint course_source_batches_run_id_fkey,
  add foreign key (run_id) references public.course_source_batch_runs(id) on delete cascade;

create function public.read_course_source_base_batch_progress(p_run uuid, p_artifact uuid, p_organization uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  progress jsonb;
begin
  if not exists(select 1 from public.course_source_batch_runs r where r.id=p_run
    and r.artifact_id=p_artifact and r.organization_id=p_organization) then
    raise exception 'SOURCE_NOT_FOUND';
  end if;
  progress:=public.command_course_source_batch(p_run,p_organization,'status');
  if progress->>'status'='COMPLETE' then
    return progress || jsonb_build_object('findings',coalesce((select jsonb_agg(b.findings order by b.path)
      from public.course_source_batches b where b.run_id=p_run and b.state='CONFIRMED'),'[]'::jsonb));
  end if;
  if progress->>'status' in ('ACTIVE','PAUSED') then
    return progress || jsonb_build_object('resumable',coalesce((select jsonb_agg(b.path order by b.path)
      from public.course_source_batches b where b.run_id=p_run and b.state='PAUSED'
        and b.diagnostic in ('TRANSIENT','ATTEMPTS_EXHAUSTED','INVALID_OUTPUT')),'[]'::jsonb));
  end if;
  return progress;
end $$;

revoke all on function public.read_course_source_base_batch_progress(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_course_source_base_batch_progress(uuid,uuid,uuid) to service_role;

commit;
