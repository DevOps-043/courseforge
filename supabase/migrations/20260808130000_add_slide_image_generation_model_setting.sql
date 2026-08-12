-- Adds the configurable OpenAI image model used for slide backgrounds and
-- source-backed supporting visuals. The API key remains a deployment secret.

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
    'BUNDLE_AGENT'::text,
    'SLIDES_DECK_BRIEF_AGENT'::text,
    'SLIDES_EVIDENCE_AGENT'::text,
    'SLIDES_STRATEGY_AGENT'::text,
    'SLIDE_TEMPLATE_TYPE_AGENT'::text,
    'SLIDES_VISIBLE_COPY_AGENT'::text,
    'SLIDES_VISUAL_TEMPLATE_AGENT'::text,
    'SLIDES_QA_AGENT'::text,
    'SLIDES_IMAGE_GENERATION'::text,
    'LIA_MODEL'::text,
    'LIA MODEL'::text,
    'COMPUTER'::text,
    'SEARCH'::text,
    'LIA_REASONING'::text,
    'LIA_COMPUTER_USE'::text
  ])) NOT VALID;

DO $$
DECLARE
  unexpected_types text;
BEGIN
  SELECT string_agg(DISTINCT COALESCE(setting_type, '<NULL>'), ', ' ORDER BY COALESCE(setting_type, '<NULL>'))
    INTO unexpected_types
  FROM public.model_settings
  WHERE setting_type IS NULL
     OR setting_type <> ALL (ARRAY[
       'ARTIFACT_BASE'::text,
       'SYLLABUS'::text,
       'INSTRUCTIONAL_PLAN'::text,
       'MATERIALS'::text,
       'CURATION'::text,
       'BUNDLE_AGENT'::text,
       'SLIDES_DECK_BRIEF_AGENT'::text,
       'SLIDES_EVIDENCE_AGENT'::text,
       'SLIDES_STRATEGY_AGENT'::text,
       'SLIDE_TEMPLATE_TYPE_AGENT'::text,
       'SLIDES_VISIBLE_COPY_AGENT'::text,
       'SLIDES_VISUAL_TEMPLATE_AGENT'::text,
       'SLIDES_QA_AGENT'::text,
       'SLIDES_IMAGE_GENERATION'::text,
       'LIA_MODEL'::text,
       'LIA MODEL'::text,
       'COMPUTER'::text,
       'SEARCH'::text,
       'LIA_REASONING'::text,
       'LIA_COMPUTER_USE'::text
     ]);

  IF unexpected_types IS NULL THEN
    ALTER TABLE public.model_settings
      VALIDATE CONSTRAINT model_settings_setting_type_check;
  ELSE
    RAISE WARNING
      'model_settings contains unsupported legacy setting_type values: %. The new constraint remains NOT VALID; no rows were deleted.',
      unexpected_types;
  END IF;
END
$$;

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
  'gpt-image-2',
  'gpt-image-2',
  0,
  'minimal',
  'Modulos: Slides',
  'SLIDES_IMAGE_GENERATION',
  true,
  NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.model_settings
  WHERE setting_type = 'SLIDES_IMAGE_GENERATION'
    AND organization_id IS NULL
);
