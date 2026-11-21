BEGIN;

ALTER TABLE public.model_settings
  ALTER COLUMN model_name SET DEFAULT 'gpt-6.1-terra',
  ALTER COLUMN fallback_model SET DEFAULT 'gpt-6.2-sol';

WITH resolved AS (
  SELECT id, setting_type,
    CASE
      WHEN trim(model_name) ~* '^(models/)?gemini([-_.]|$)'
        THEN CASE WHEN setting_type = 'SLIDES_IMAGE_GENERATION'
          THEN 'gpt-image-2' ELSE 'gpt-6.1-terra' END
      ELSE model_name
    END AS primary_model,
    CASE
      WHEN trim(fallback_model) ~* '^(models/)?gemini([-_.]|$)'
        THEN CASE WHEN setting_type = 'SLIDES_IMAGE_GENERATION'
          THEN 'gpt-image-2' ELSE 'gpt-6.2-sol' END
      ELSE fallback_model
    END AS backup_model
  FROM public.model_settings
  WHERE is_active IS TRUE
    AND (trim(model_name) ~* '^(models/)?gemini([-_.]|$)'
      OR trim(fallback_model) ~* '^(models/)?gemini([-_.]|$)')
)
UPDATE public.model_settings AS settings
SET model_name = resolved.primary_model,
    fallback_model = CASE
      WHEN resolved.setting_type = 'SLIDES_IMAGE_GENERATION'
        OR resolved.backup_model IS DISTINCT FROM resolved.primary_model
        THEN resolved.backup_model
      WHEN resolved.primary_model = 'gpt-6.2-sol' THEN 'gpt-6.1-terra'
      ELSE 'gpt-6.2-sol'
    END,
    updated_at = now()
FROM resolved
WHERE settings.id = resolved.id;

WITH resolved AS (
  SELECT organization_id,
    CASE WHEN trim(agent_model) ~* '^(models/)?gemini([-_.]|$)'
      THEN 'gpt-6.1-terra' ELSE agent_model END AS primary_model,
    CASE WHEN trim(fallback_model) ~* '^(models/)?gemini([-_.]|$)'
      THEN 'gpt-6.2-sol' ELSE fallback_model END AS backup_model
  FROM public.video_composition_generation_settings
  WHERE trim(agent_model) ~* '^(models/)?gemini([-_.]|$)'
     OR trim(fallback_model) ~* '^(models/)?gemini([-_.]|$)'
)
UPDATE public.video_composition_generation_settings AS settings
SET agent_model = resolved.primary_model,
    fallback_model = CASE
      WHEN resolved.backup_model IS DISTINCT FROM resolved.primary_model
        THEN resolved.backup_model
      WHEN resolved.primary_model = 'gpt-6.2-sol' THEN 'gpt-6.1-terra'
      ELSE 'gpt-6.2-sol'
    END,
    updated_at = now()
FROM resolved
WHERE settings.organization_id = resolved.organization_id;

COMMIT;
