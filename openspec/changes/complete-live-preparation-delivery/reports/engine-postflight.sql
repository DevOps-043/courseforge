-- Solo catálogo y cantidades de tablas nuevas; no ejecuta RPCs de escritura.
select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
   'public_access',exists(select 1 from unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
     where has_table_privilege(r,c.oid,p)))) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in
   ('course_delivery_workspaces','course_delivery_versions','course_delivery_runs')),
 'counts',jsonb_build_object('workspaces',(select count(*) from public.course_delivery_workspaces),'versions',(select count(*) from public.course_delivery_versions),'runs',(select count(*) from public.course_delivery_runs)),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definer',p.prosecdef,'settings',p.proconfig,
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
   ('preserve_course_delivery_version','save_course_delivery','reserve_course_delivery_run','claim_course_delivery_run','commit_course_delivery_unit','approve_course_delivery','save_course_delivery_setting')),
 'trigger',exists(select 1 from pg_trigger where tgrelid='public.course_delivery_workspaces'::regclass and tgname='preserve_course_delivery_version' and not tgisinternal and tgenabled='O'),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check)) from pg_policies
   where schemaname='public' and policyname in ('course_delivery_models_backend_only','course_delivery_prompts_backend_only')),
 'model_type_check',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.model_settings'::regclass and conname='model_settings_setting_type_check')
) as postflight;
