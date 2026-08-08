-- Isolates Bundle Agent provider configuration from the Materials pipeline.
-- Additive and backward-compatible: existing rows are preserved.
--
-- LIA_MODEL, "LIA MODEL", COMPUTER, SEARCH, LIA_REASONING and
-- LIA_COMPUTER_USE are legacy values. They cannot be removed here because the
-- desktop/LIA integration still reads some of them and older installations may
-- still contain the earlier seed values. NOT VALID prevents an unrelated,
-- unknown legacy value from blocking this additive migration while the CHECK
-- still protects every new or modified row.

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
    'LIA_MODEL'::text,
    'LIA MODEL'::text,
    'COMPUTER'::text,
    'SEARCH'::text,
    'LIA_REASONING'::text,
    'LIA_COMPUTER_USE'::text
  ])) NOT VALID;

-- Validate immediately when the current dataset is clean. If an installation
-- contains another historical value, keep the constraint enforcing future
-- writes and report the value instead of deleting user configuration.
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
  setting_type,
  is_active,
  organization_id
)
SELECT
  'gemini-2.5-flash',
  'gpt-4.1-mini',
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
