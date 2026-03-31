-- Migration: Modularize pipeline model settings
-- 1. Deactivate obsolete setting types (LIA_MODEL, COMPUTER)
-- 2. Insert missing pipeline step defaults (ARTIFACT_BASE, SYLLABUS, INSTRUCTIONAL_PLAN)
-- 3. Update org-defaults trigger to reflect new pipeline steps

-- =============================================
-- STEP 1: Deactivate obsolete model settings
-- =============================================
UPDATE public.model_settings
SET is_active = false
WHERE setting_type IN ('LIA_MODEL', 'LIA MODEL', 'COMPUTER');

-- =============================================
-- STEP 2: Insert global defaults for new pipeline steps
-- (only if no active row exists for that setting_type)
-- =============================================
INSERT INTO public.model_settings (
  model_name,
  temperature,
  is_active,
  fallback_model,
  thinking_level,
  setting_type,
  organization_id
)
SELECT * FROM (VALUES
  ('gemini-2.5-flash', 0.70::numeric, true, 'gemini-2.0-flash', 'medium', 'ARTIFACT_BASE',       NULL::uuid),
  ('gemini-2.5-flash', 0.70::numeric, true, 'gemini-2.0-flash', 'medium', 'SYLLABUS',             NULL::uuid),
  ('gemini-2.5-flash', 0.70::numeric, true, 'gemini-2.0-flash', 'medium', 'INSTRUCTIONAL_PLAN',   NULL::uuid)
) AS v(model_name, temperature, is_active, fallback_model, thinking_level, setting_type, organization_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_settings ms
  WHERE ms.setting_type = v.setting_type
    AND ms.organization_id IS NOT DISTINCT FROM NULL
    AND ms.is_active = true
)
ON CONFLICT DO NOTHING;

-- =============================================
-- STEP 3: Update org-defaults trigger function
-- Remove LIA_MODEL + COMPUTER; add ARTIFACT_BASE, SYLLABUS, INSTRUCTIONAL_PLAN
-- =============================================
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
    ('gemini-2.5-pro',   '0.10', true, 'gemini-2.5-flash', 'high',   'CURATION',           NEW.id)
  ON CONFLICT DO NOTHING;

  -- Insertar system_prompts por defecto para la nueva organización
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
      '# PROMPT — FASE 2: Curaduría y trazabilidad (Fuentes + Bitácora)
Actúa como controlador instruccional para un curso de microlearning.
Usa la herramienta de búsqueda web para encontrar fuentes válidas en tiempo real.
Responde SOLO con JSON válido según la estructura definida.',
      'Prompt para la curaduría de contenidos (Paso 4)',
      true,
      NEW.id
    ),
    (
      'INSTRUCTIONAL_PLAN',
      '1.0.0',
      'Actúa como controlador instruccional para un curso de microlearning.
Genera el plan instruccional con objetivos de aprendizaje Bloom, componentes y criterios medibles.
Responde SOLO con JSON válido según la estructura definida.',
      'Prompt para generar el plan instruccional (Paso 3)',
      true,
      NEW.id
    ),
    (
      'MATERIALS_GENERATION',
      '1.0.0',
      'Actúa como motor de producción instruccional para microlearning.
Genera los materiales finales de una lección usando el Prompt Maestro.
Responde SOLO con JSON válido según la estructura definida.',
      'Prompt Maestro para generación de materiales (Paso 5)',
      true,
      NEW.id
    )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
