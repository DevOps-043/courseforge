-- Solo catálogo; no lee documentos, usuarios ni valores de configuración.
with required(table_name,column_name) as (values
 ('organizations','id'),('artifacts','id'),('artifacts','organization_id'),
 ('syllabus','artifact_id'),('syllabus','modules'),('syllabus','state'),
 ('instructional_plans','artifact_id'),('instructional_plans','lesson_plans'),('instructional_plans','state'),
 ('materials','artifact_id'),('curation','id'),('curation','artifact_id'),('curation','state'),
 ('curation_rows','id'),('curation_rows','curation_id'),
 ('model_settings','organization_id'),('model_settings','setting_type'),('model_settings','scope'),('model_settings','is_active'),
 ('model_settings','model_name'),('model_settings','fallback_model'),('model_settings','temperature'),('model_settings','thinking_level'),
 ('system_prompts','organization_id'),('system_prompts','code'),('system_prompts','scope'),('system_prompts','version'),
 ('system_prompts','content'),('system_prompts','description'),('system_prompts','is_active'),('system_prompts','created_by'),('system_prompts','source')
), new_functions(name) as (values
 ('preserve_course_delivery_version'),('save_course_delivery'),('reserve_course_delivery_run'),('claim_course_delivery_run'),
 ('commit_course_delivery_unit'),('approve_course_delivery'),('save_course_delivery_setting')
)
select jsonb_build_object(
 'missing_columns',(select coalesce(jsonb_agg(r),'[]'::jsonb) from required r where not exists
   (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name)),
 'existing_tables',(select coalesce(jsonb_agg(relname),'[]'::jsonb) from pg_class where relnamespace='public'::regnamespace and relname in
   ('course_delivery_workspaces','course_delivery_versions','course_delivery_runs')),
 'existing_functions',(select coalesce(jsonb_agg(proname),'[]'::jsonb) from pg_proc where pronamespace='public'::regnamespace and proname in (select name from new_functions)),
 'service_role',(select jsonb_build_object('superuser',rolsuper,'bypassrls',rolbypassrls) from pg_roles where rolname='service_role'),
 'base_privileges',(select jsonb_agg(jsonb_build_object('table',t,'select',has_table_privilege('service_role',to_regclass('public.'||t),'SELECT'),
   'update',has_table_privilege('service_role',to_regclass('public.'||t),'UPDATE'),
   'insert',has_table_privilege('service_role',to_regclass('public.'||t),'INSERT'))) from unnest(array['artifacts','syllabus','instructional_plans','materials','curation','curation_rows','model_settings','system_prompts']) t),
 'settings_sequences',(select coalesce(jsonb_agg(jsonb_build_object('name',s.oid::regclass::text,
   'usage',has_sequence_privilege('service_role',s.oid,'USAGE'))),'[]'::jsonb) from pg_class s
   join pg_depend d on d.objid=s.oid and d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass
   where s.relkind='S' and d.refobjid in (to_regclass('public.model_settings'),to_regclass('public.system_prompts'))),
 'settings_rls',(select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity)) from pg_class where relnamespace='public'::regnamespace and relname in ('model_settings','system_prompts')),
 'settings_columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'udt',udt_name,
   'nullable',is_nullable,'default',column_default)) from information_schema.columns
   where table_schema='public' and table_name in ('model_settings','system_prompts')),
 'settings_constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,
   'definition',pg_get_constraintdef(oid),'validated',convalidated)),'[]'::jsonb) from pg_constraint
   where conrelid in (to_regclass('public.model_settings'),to_regclass('public.system_prompts'))),
 'settings_policies',(select coalesce(jsonb_agg(p),'[]'::jsonb) from (select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('model_settings','system_prompts')) p),
 'model_type_check',(select jsonb_build_object('definition',pg_get_constraintdef(oid),'validated',convalidated) from pg_constraint
   where conrelid=to_regclass('public.model_settings') and conname='model_settings_setting_type_check')
) as preflight;
