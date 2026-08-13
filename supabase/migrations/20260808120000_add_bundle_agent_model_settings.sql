-- Isolates Bundle Agent provider configuration from the Materials pipeline.
-- Additive and backward-compatible: existing rows are preserved.

ALTER TABLE public.model_settings
  DROP CONSTRAINT IF EXISTS model_settings_setting_type_check;

ALTER TABLE public.model_settings
  ADD CONSTRAINT model_settings_setting_type_check
  CHECK (setting_type = ANY (ARRAY[
    'ARTIFACT_BASE'::text,
    'SYLLABUS'::text,
    'INSTRUCTIONAL_PLAN'::text,
    'MATERIALS'::text,
    'CURATION'::text,
    'BUNDLE_AGENT'::text
  ]));

INSERT INTO public.model_settings (
  model_name,
  fallback_model,
  temperature,
  thinking_level,
  setting_type,
  is_active,
  organization_id
)
SELECT
  'gemini-3.6-flash',
  'gpt-5.6-luna',
  0.30,
  'medium',
  'BUNDLE_AGENT',
  true,
  NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.model_settings
  WHERE setting_type = 'BUNDLE_AGENT'
    AND organization_id IS NULL
);

