-- Normalize generated-material terminology after the assistant rename.
-- This updates prompt catalogue content so future generations say SofLIA.
-- Technical setting names such as LIA_MODEL are intentionally not touched.

UPDATE public.system_prompts
SET
  content = regexp_replace(
    regexp_replace(content, '\mLia\M', 'SofLIA', 'g'),
    '\mLIA\M',
    'SofLIA',
    'g'
  ),
  updated_at = now()
WHERE code IN (
    'INSTRUCTIONAL_PLAN',
    'MATERIALS_GENERATION',
    'MATERIALS_SYSTEM',
    'MATERIALS_DIALOGUE'
  )
  AND (
    content ~ '\mLia\M'
    OR content ~ '\mLIA\M'
  );
