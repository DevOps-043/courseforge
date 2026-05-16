# SOFLIA_DIALOGUE prompt normalization runbook

## Objetivo

Evitar que CourseEngine siga generando actividades conversacionales legacy con `scenes`, `mission_brief` o `lia_script`.

El estado correcto para nuevas actividades DIALOGUE es:

```text
activity_type = ai_chat
activity_schema_version = 2
activity_config.interactionType = soflia_dialogue
activity_config.runtimeType = SOFLIA_DIALOGUE
requires_soflia_validation = false
```

## Que te corresponde correr

Corre este archivo contra la base de datos de CourseForge:

```text
supabase/migrations/20260515160000_normalize_soflia_dialogue_prompts.sql
```

Si lo haces desde Supabase SQL Editor, pega y ejecuta el contenido completo del archivo.

Importante: si existen filas con `organization_id` en `system_prompts`, esas filas son overrides por organizacion y ganan sobre el prompt global. La migracion normaliza tambien esas filas: desactiva los `MATERIALS_DIALOGUE` activos y deja un `MATERIALS_DIALOGUE` `2.0.0` activo para cada scope que ya tenia prompt activo, incluyendo organizaciones.

## Auditoria antes de correr el SQL

```sql
select
  id,
  code,
  version,
  organization_id,
  is_active,
  content like '%SOFLIA_DIALOGUE%' as has_soflia_runtime,
  content like '%scenes%' as has_legacy_scenes,
  content like '%mission_brief%' as has_legacy_mission_brief,
  content ~ '\mLia\M' as has_lia_label
from public.system_prompts
where code in (
  'INSTRUCTIONAL_PLAN',
  'MATERIALS_SYSTEM',
  'MATERIALS_GENERATION',
  'MATERIALS_DIALOGUE'
)
order by code, organization_id nulls first, version;
```

## Auditoria despues de correr el SQL

```sql
select
  code,
  organization_id,
  count(*) filter (where is_active) as active_rows,
  bool_or(content like '%SOFLIA_DIALOGUE%') filter (where code = 'MATERIALS_DIALOGUE' and is_active) as dialogue_has_runtime,
  bool_or(content like '%scenes%') filter (where code = 'MATERIALS_DIALOGUE' and is_active) as dialogue_mentions_scenes,
  bool_or(content ~ '\mLia\M') filter (where is_active) as active_prompt_mentions_lia
from public.system_prompts
where code in (
  'INSTRUCTIONAL_PLAN',
  'MATERIALS_SYSTEM',
  'MATERIALS_GENERATION',
  'MATERIALS_DIALOGUE'
)
group by code, organization_id
order by code, organization_id nulls first;
```

Resultado esperado:

- `MATERIALS_DIALOGUE` activo contiene `SOFLIA_DIALOGUE`.
- Cada organizacion que tenia override activo queda con `MATERIALS_DIALOGUE` version `2.0.0`.
- `MATERIALS_DIALOGUE` activo no menciona `scenes`.
- Los prompts activos de generacion no mencionan `Lia`.

## Regeneracion necesaria

El SQL corrige prompts futuros. No convierte materiales ya generados.

Para cursos existentes, regenera los componentes `DIALOGUE` que no tengan contrato runtime:

```sql
select
  mc.id as material_component_id,
  mc.material_lesson_id,
  ml.lesson_title,
  mc.content->>'runtimeType' as runtime_type,
  mc.content ? 'scenes' as has_legacy_scenes
from public.material_components mc
join public.material_lessons ml on ml.id = mc.material_lesson_id
where mc.type = 'DIALOGUE'
  and coalesce(mc.content->>'runtimeType', '') <> 'SOFLIA_DIALOGUE'
order by ml.lesson_title;
```

Esos registros deben regenerarse desde CourseEngine antes de publicar. El codigo ahora bloquea publicacion de `DIALOGUE` legacy para evitar que SofLIA Learning reciba `lia_script`.

## Verificacion en publicacion

Despues de publicar un curso de prueba, valida en SofLIA Learning:

```sql
select
  activity_id,
  activity_title,
  activity_type,
  activity_schema_version,
  activity_config->>'interactionType' as interaction_type,
  activity_config->>'runtimeType' as runtime_type,
  requires_soflia_validation
from public.lesson_activities
where activity_type = 'ai_chat'
order by created_at desc
limit 20;
```

Resultado esperado:

```text
activity_type = ai_chat
activity_schema_version = 2
interaction_type = soflia_dialogue
runtime_type = SOFLIA_DIALOGUE
requires_soflia_validation = false
```
