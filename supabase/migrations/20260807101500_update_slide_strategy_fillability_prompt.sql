-- Version SLIDES_STRATEGY_AGENT to avoid selecting slide types that cannot be filled by available evidence.

UPDATE public.system_prompts
SET is_active = false
WHERE code = 'SLIDES_STRATEGY_AGENT'
  AND organization_id IS NULL
  AND is_active = true;

INSERT INTO public.system_prompts (
  code,
  scope,
  version,
  content,
  description,
  is_active,
  source,
  change_summary,
  parent_prompt_id
)
SELECT
  'SLIDES_STRATEGY_AGENT',
  'Modulos: Slides',
  '1.0.2',
  $$Objetivo:
Seleccionar los tipos de diapositiva que debe usar una leccion antes de renderizar HTML.

Entradas esperadas:
- {{deckBrief}}
- {{lessonObjective}}
- {{scriptOutline}}
- {{storyboardOutline}}
- {{curatedSources}}
- {{sourceInsightCounts}}
- {{allowedTemplateTypes}}
- {{customInstructions}}

Tipos base soportados:
cover, objectives, concept, worked_example, exercise, knowledge_check, summary, data_explainer, diagram, quote, transition.

Reglas:
- Usa el guion para inferir secuencia, intencion pedagogica y tipo de slide; no lo conviertas en transcripcion visible.
- El contenido visible debe mapearse a fuentes curadas o claims ya respaldados por evidencia.
- No selecciones un tipo de slide si la evidencia disponible no puede rellenar sus campos principales.
- Usa worked_example o exercise solo si existen practicas, pasos, ejemplos aplicables o evidencia de accion concreta.
- Usa knowledge_check solo si existen preguntas, errores comunes, evaluacion o reflexion comprobable.
- Si una seccion no tiene evidencia compatible para un tipo especializado, usa concept o summary antes que inventar contenido.
- Usa data_explainer solo cuando existan datos pedagogicos reales, no duraciones ni timecodes del video.
- Mantén una slide por idea principal cuando sea posible.$$,
  'Agente de estrategia para seleccionar tipos de slides HTML',
  true,
  'SEED',
  'Evita seleccionar tipos de diapositiva que no pueden rellenarse con la evidencia disponible',
  (
    SELECT id
    FROM public.system_prompts
    WHERE code = 'SLIDES_STRATEGY_AGENT'
      AND organization_id IS NULL
      AND version = '1.0.1'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_prompts
  WHERE code = 'SLIDES_STRATEGY_AGENT'
    AND organization_id IS NULL
    AND version = '1.0.2'
);

UPDATE public.system_prompts
SET is_active = true
WHERE code = 'SLIDES_STRATEGY_AGENT'
  AND organization_id IS NULL
  AND version = '1.0.2';
