-- Migration: Fix model_settings defaults and system_prompts unique constraint
-- 1. Update model_settings column defaults to reflect current pipeline models
-- 2. Add CHECK constraint on setting_type with valid pipeline step values
-- 3. Add UNIQUE constraint on system_prompts (code, version, organization_id)

-- =============================================
-- STEP 1: Update model_settings defaults
-- =============================================
ALTER TABLE public.model_settings
  ALTER COLUMN model_name    SET DEFAULT 'gemini-2.5-flash',
  ALTER COLUMN fallback_model SET DEFAULT 'gemini-2.5-flash',
  ALTER COLUMN temperature   SET DEFAULT 0.70,
  ALTER COLUMN thinking_level SET DEFAULT 'medium';

-- =============================================
-- STEP 2: Delete obsolete rows (LIA_MODEL, COMPUTER, NULL, SEARCH)
-- These were already deactivated by 20260331120000 migration.
-- The CHECK constraint rejects any row with these values regardless
-- of is_active, so they must be removed before the constraint is added.
-- =============================================
DELETE FROM public.model_settings
  WHERE setting_type IS NULL
     OR setting_type NOT IN (
       'ARTIFACT_BASE', 'SYLLABUS', 'INSTRUCTIONAL_PLAN', 'MATERIALS', 'CURATION'
     );

-- =============================================
-- STEP 3: Add CHECK constraint on setting_type
-- (drop first in case a partial version exists)
-- =============================================
ALTER TABLE public.model_settings
  DROP CONSTRAINT IF EXISTS model_settings_setting_type_check;

ALTER TABLE public.model_settings
  ADD CONSTRAINT model_settings_setting_type_check
  CHECK (setting_type = ANY (ARRAY[
    'ARTIFACT_BASE'::text,
    'SYLLABUS'::text,
    'INSTRUCTIONAL_PLAN'::text,
    'MATERIALS'::text,
    'CURATION'::text
  ]));

-- =============================================
-- STEP 4: Add UNIQUE constraint on system_prompts
-- (already added by 20260307 migration — this is
--  a safety net in case it wasn't applied)
-- =============================================
ALTER TABLE public.system_prompts
  DROP CONSTRAINT IF EXISTS system_prompts_code_version_org_key;

ALTER TABLE public.system_prompts
  ADD CONSTRAINT system_prompts_code_version_org_key
  UNIQUE (code, version, organization_id);
