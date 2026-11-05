-- Solo Engine emsjctbdevufloxntjll, después de postflight aprobado y consulta de historial sin filas.
-- Registra la aplicación manual; no ejecuta DDL de negocio ni modifica cursos o configuración.
begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'DELIVERY_HISTORY_TABLE_REQUIRED';
  end if;
  lock table supabase_migrations.schema_migrations in share row exclusive mode;

  if (select count(*) from pg_class c where c.relnamespace='public'::regnamespace
      and c.relname in ('course_delivery_workspaces','course_delivery_versions','course_delivery_runs')
      and c.relrowsecurity
      and not exists(select 1 from unnest(array['anon','authenticated']) r
        cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,c.oid,p))) <> 3 then
    raise exception 'DELIVERY_HISTORY_SCHEMA_NOT_READY';
  end if;
  if (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
      ('preserve_course_delivery_version','save_course_delivery','reserve_course_delivery_run','claim_course_delivery_run',
       'commit_course_delivery_unit','approve_course_delivery','save_course_delivery_setting')
      and not p.prosecdef and 'search_path=""'=any(p.proconfig)
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and (p.proname='preserve_course_delivery_version'
        or has_function_privilege('service_role',p.oid,'EXECUTE'))) <> 7 then
    raise exception 'DELIVERY_HISTORY_FUNCTIONS_NOT_READY';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.course_delivery_workspaces'::regclass
      and tgname='preserve_course_delivery_version' and not tgisinternal and tgenabled='O')
    or (select count(*) from pg_policies where schemaname='public' and
      ((tablename='model_settings' and policyname='course_delivery_models_backend_only') or
       (tablename='system_prompts' and policyname='course_delivery_prompts_backend_only'))
      and permissive='RESTRICTIVE' and cmd='ALL' and roles::text[] @> array['anon','authenticated']
      and qual=with_check and qual like '%SYNCHRONOUS_AGENDA%'
      and qual like '%SYNCHRONOUS_PLAN%' and qual like '%SYNCHRONOUS_MATERIALS%') <> 2 then
    raise exception 'DELIVERY_HISTORY_GUARDS_NOT_READY';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.model_settings'::regclass
      and conname='model_settings_setting_type_check'
      and pg_get_constraintdef(oid) like '%SYNCHRONOUS_AGENDA%'
      and pg_get_constraintdef(oid) like '%SYNCHRONOUS_PLAN%'
      and pg_get_constraintdef(oid) like '%SYNCHRONOUS_MATERIALS%') then
    raise exception 'DELIVERY_HISTORY_CHECK_NOT_READY';
  end if;

  if exists(select 1 from supabase_migrations.schema_migrations
      where (version='20261026160000' and name is distinct from 'synchronous_course_delivery')
         or (name='synchronous_course_delivery' and version<>'20261026160000')) then
    raise exception 'DELIVERY_HISTORY_IDENTITY_CONFLICT';
  end if;
  insert into supabase_migrations.schema_migrations(version,name)
    values('20261026160000','synchronous_course_delivery') on conflict(version) do nothing;
end $$;
commit;

select version,name from supabase_migrations.schema_migrations where version='20261026160000';
