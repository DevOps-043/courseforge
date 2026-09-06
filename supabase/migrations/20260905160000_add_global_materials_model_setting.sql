-- Provide an editable database-backed baseline for Materials.
-- Organization-specific settings remain untouched and take precedence.

BEGIN;

INSERT INTO public.model_settings (
  model_name,
  fallback_model,
  temperature,
  thinking_level,
  scope,
  setting_type,
  is_active,
  organization_id
)
SELECT
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  0.70,
  'medium',
  'Cursos',
  'MATERIALS',
  true,
  NULL::uuid
WHERE NOT EXISTS (
  SELECT 1
  FROM public.model_settings
  WHERE setting_type = 'MATERIALS'
    AND organization_id IS NULL
    AND is_active = true
);

COMMIT;
