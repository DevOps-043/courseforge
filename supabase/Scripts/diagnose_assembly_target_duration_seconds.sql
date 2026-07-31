-- =============================================================================
-- DIAGNOSTICO (SOLO LECTURA) - assembly_target_duration_seconds envenenado
-- =============================================================================
--
-- Contexto: `assembly_target_duration_seconds` es un campo legado de una
-- estimacion de duracion basada en el guion (Fase 5 - Materiales), calculada
-- por `deriveAssemblyTargetDurationSeconds()` en `apps/web/src/remotion/assembly-duration.ts`.
-- Esa funcion y todos sus call-sites fueron eliminados del codigo (commit
-- a41013aa) a favor de medir la duracion real de los assets (voz/avatar/broll)
-- con `mediabunny` / elementos <audio>/<video>. El campo, sin embargo, se quedo
-- en el schema y en la logica de resolucion de duracion con prioridad sobre la
-- duracion real medida, por lo que cualquier componente que lo haya recibido
-- ANTES de ese refactor quedo con un valor de duracion "sucio" (derivado del
-- guion, no de un archivo real) que nunca se vuelve a limpiar por si solo.
--
-- Este script NO modifica datos. Solo lista los `material_components` cuyo
-- `assets.assembly_target_duration_seconds` esta seteado, junto con las
-- duraciones reales medidas de sus assets, para que el equipo decida cuales
-- filas limpiar manualmente (o via un script de backfill separado, con
-- aprobacion explicita antes de tocar produccion).
--
-- Nota: la columna `measured_duration_seconds_approx` es una APROXIMACION de
-- la jerarquia real (`apps/web/src/remotion/assembly-assets.normalizer.ts`):
-- toma el maximo entre voz, avatar (single_video), suma de avatar_clips y suma
-- de b_roll_clips. No replica exactamente el orden de prioridad por modo de
-- avatar (`scene_clips` vs `single_video`) ni el fallback de slides; sirve para
-- priorizar la revision manual, no como fuente de verdad para un fix automatico.
-- =============================================================================

with target_components as (
  select
    mc.id as component_id,
    mc.type as component_type,
    mc.assets,
    (mc.assets ->> 'assembly_target_duration_seconds')::numeric as target_duration_seconds,
    ml.lesson_title,
    ml.module_title,
    m.artifact_id
  from public.material_components mc
  join public.material_lessons ml on ml.id = mc.material_lesson_id
  join public.materials m on m.id = ml.materials_id
  where (mc.assets ->> 'assembly_target_duration_seconds') is not null
    and (mc.assets ->> 'assembly_target_duration_seconds')::numeric > 0
),
measured as (
  select
    tc.*,
    a.idea_central as artifact_idea_central,
    a.organization_id,
    nullif(tc.assets #>> '{voice_audio,duration}', '')::numeric as voice_duration_seconds,
    nullif(tc.assets #>> '{avatar_video,duration}', '')::numeric as avatar_video_duration_seconds,
    (
      select coalesce(sum(nullif(clip ->> 'duration', '')::numeric), 0)
      from jsonb_array_elements(coalesce(tc.assets -> 'avatar_clips', '[]'::jsonb)) as clip
      where coalesce((clip ->> 'deleted')::boolean, false) = false
        and (clip ->> 'public_url') is not null
    ) as avatar_clips_duration_seconds,
    (
      select coalesce(sum(nullif(clip ->> 'duration', '')::numeric), 0)
      from jsonb_array_elements(coalesce(tc.assets -> 'b_roll_clips', '[]'::jsonb)) as clip
      where (clip ->> 'public_url') is not null
    ) as b_roll_duration_seconds,
    coalesce(jsonb_array_length(tc.assets #> '{slides,images}'), 0) as slide_count
  from target_components tc
  join public.artifacts a on a.id = tc.artifact_id
)
select
  organization_id,
  artifact_idea_central,
  lesson_title,
  module_title,
  component_type,
  component_id,
  target_duration_seconds,
  voice_duration_seconds,
  avatar_video_duration_seconds,
  avatar_clips_duration_seconds,
  b_roll_duration_seconds,
  slide_count,
  greatest(
    coalesce(voice_duration_seconds, 0),
    coalesce(avatar_video_duration_seconds, 0),
    coalesce(avatar_clips_duration_seconds, 0),
    coalesce(b_roll_duration_seconds, 0)
  ) as measured_duration_seconds_approx,
  round(
    target_duration_seconds - greatest(
      coalesce(voice_duration_seconds, 0),
      coalesce(avatar_video_duration_seconds, 0),
      coalesce(avatar_clips_duration_seconds, 0),
      coalesce(b_roll_duration_seconds, 0)
    ),
    1
  ) as divergence_seconds
from measured
order by divergence_seconds desc nulls last;
