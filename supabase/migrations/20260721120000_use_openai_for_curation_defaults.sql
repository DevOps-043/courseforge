-- Migration: Use OpenAI defaults for Step 4 source curation.
--
-- The curation background job now uses OpenAI Responses API with web_search.
-- Existing active CURATION settings that still point to Gemini are migrated to
-- OpenAI defaults. Explicit OpenAI settings are preserved.

ALTER TABLE public.model_settings
DROP CONSTRAINT IF EXISTS model_settings_thinking_level_check;

ALTER TABLE public.model_settings
ADD CONSTRAINT model_settings_thinking_level_check
CHECK (
  thinking_level = ANY (
    ARRAY[
      'minimal'::text,
      'none'::text,
      'low'::text,
      'medium'::text,
      'high'::text,
      'xhigh'::text,
      'max'::text
    ]
  )
);

UPDATE public.model_settings
SET
  model_name = 'gpt-5.6-luna',
  fallback_model = 'gpt-5.6-terra',
  thinking_level = 'low',
  updated_at = NOW()
WHERE setting_type = 'CURATION'
  AND is_active = true
  AND (
    model_name ILIKE 'gemini-%'
    OR fallback_model ILIKE 'gemini-%'
  );

CREATE OR REPLACE FUNCTION public.populate_default_org_settings()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.model_settings (
    model_name,
    temperature,
    is_active,
    fallback_model,
    thinking_level,
    setting_type,
    organization_id
  ) VALUES
    ('gemini-2.5-flash', '0.70', true, 'gemini-2.0-flash', 'medium', 'ARTIFACT_BASE',     NEW.id),
    ('gemini-2.5-flash', '0.70', true, 'gemini-2.0-flash', 'medium', 'SYLLABUS',           NEW.id),
    ('gemini-2.5-flash', '0.70', true, 'gemini-2.0-flash', 'medium', 'INSTRUCTIONAL_PLAN', NEW.id),
    ('gemini-2.5-pro',   '0.70', true, 'gemini-2.5-flash', 'minimal','MATERIALS',          NEW.id),
    ('gpt-5.6-luna',     '0.10', true, 'gpt-5.6-terra',    'low',    'CURATION',           NEW.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.system_prompts (
    code,
    version,
    content,
    description,
    is_active,
    organization_id
  ) VALUES
    (
      'CURATION_PLAN',
      '1.0.0',
      '# PROMPT — FASE 2: Curaduria y trazabilidad (Fuentes + Bitacora)
Actua como controlador instruccional para un curso de microlearning.
Usa la herramienta de busqueda web de OpenAI para encontrar fuentes validas en tiempo real.
Responde SOLO con JSON valido segun la estructura definida.',
      'Prompt para la curaduria de contenidos (Paso 4)',
      true,
      NEW.id
    ),
    (
      'INSTRUCTIONAL_PLAN',
      '1.0.0',
      'Actua como controlador instruccional para un curso de microlearning.
Genera el plan instruccional con objetivos de aprendizaje Bloom, componentes y criterios medibles.
Responde SOLO con JSON valido segun la estructura definida.',
      'Prompt para generar el plan instruccional (Paso 3)',
      true,
      NEW.id
    ),
    (
      'MATERIALS_GENERATION',
      '1.0.0',
      'Actua como motor de produccion instruccional para microlearning.
Genera los materiales finales de una leccion usando el Prompt Maestro.
Responde SOLO con JSON valido segun la estructura definida.',
      'Prompt Maestro para generacion de materiales (Paso 5)',
      true,
      NEW.id
    )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
