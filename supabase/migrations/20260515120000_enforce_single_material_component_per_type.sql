-- Keep only the latest generated row for each lesson/component type before
-- enforcing the Courseforge invariant used by publication and regeneration.
WITH ranked_components AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY material_lesson_id, type
      ORDER BY iteration_number DESC, generated_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.material_components
)
DELETE FROM public.material_components component
USING ranked_components ranked
WHERE component.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_material_components_lesson_type_unique
  ON public.material_components (material_lesson_id, type);
