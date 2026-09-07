-- Replace retired Gemini 2.0 runtime settings across global and tenant scopes.
-- Primary models move to Gemini 3.5 Flash; fallbacks move to Gemini 2.5 Flash.

BEGIN;

-- Production can contain slide-agent rows created while an older version of
-- this constraint was still deployed. Recreate the current allowlist first so
-- those rows can be updated safely.
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

UPDATE public.model_settings
SET
  model_name = CASE
    WHEN model_name ~* '^gemini-2\.0' THEN 'gemini-3.5-flash'
    ELSE model_name
  END,
  fallback_model = CASE
    WHEN fallback_model ~* '^gemini-2\.0' THEN 'gemini-2.5-flash'
    ELSE fallback_model
  END,
  updated_at = now()
WHERE model_name ~* '^gemini-2\.0'
   OR fallback_model ~* '^gemini-2\.0';

ALTER TABLE public.model_settings
  DROP CONSTRAINT IF EXISTS model_settings_no_retired_gemini_2_models;

ALTER TABLE public.model_settings
  ADD CONSTRAINT model_settings_no_retired_gemini_2_models
  CHECK (
    model_name !~* '^gemini-2\.0'
    AND COALESCE(fallback_model, '') !~* '^gemini-2\.0'
  );

COMMIT;
