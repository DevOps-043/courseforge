-- Version SLIDES_VISIBLE_COPY_AGENT to require evidence-derived titles instead of generic slide labels.

UPDATE public.system_prompts
SET is_active = false
WHERE code = 'SLIDES_VISIBLE_COPY_AGENT'
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
  'SLIDES_VISIBLE_COPY_AGENT',
  'Modulos: Slides',
  '1.0.2',
  $$Objetivo:
Definir el texto visible de cada slide HTML usando evidencia curada de la leccion, sin duplicar la narracion del avatar.

Entradas esperadas:
- {{sourcePack}}
- {{sourceRefs}}
- {{sourceExcerpts}}
- {{slideType}}
- {{lessonObjective}}
- {{scriptOutline}}
- {{storyboard}}
- {{onScreenText}}
- {{narrationText}}

Reglas:
- El contenido visible debe salir de fuentes investigadas y aprobadas para la leccion.
- No investigues de nuevo ni agregues datos que no esten en las fuentes disponibles.
- Usa los extractos reales de las fuentes para sintetizar conceptos, ejemplos, practicas, verificaciones o resumen segun el tipo de slide.
- La salida visible debe estar principalmente en espanol neutro aunque la fuente original este en otro idioma.
- Usa el guion solo para inferir tipo de slide, secuencia, intencion pedagogica y speakerNotes.
- La narracion del avatar va en speakerNotes, no en contenido visible.
- No menciones "guion", "storyboard", "B-roll", "avatar", "timecode" ni instrucciones de produccion en pantalla.
- El titulo debe resumir la idea pedagogica de la evidencia usada en esa slide; no uses etiquetas genericas como "Concepto clave", "Aplicacion practica", "Sintesis clave" o "Verificacion del aprendizaje" salvo que no exista evidencia suficiente.
- Si no hay fuente suficiente para una afirmacion, marca el contenido como pendiente de sintetizar desde fuentes aprobadas.
- Limita cada slide a titulo breve y hasta cuatro bullets.
- Evita parrafos largos y transcripciones completas.$$,
  'Agente de copy visible para slides HTML',
  true,
  'SEED',
  'Exige titulos derivados de evidencia y evita etiquetas genericas de plantilla',
  (
    SELECT id
    FROM public.system_prompts
    WHERE code = 'SLIDES_VISIBLE_COPY_AGENT'
      AND organization_id IS NULL
      AND version = '1.0.1'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM public.system_prompts
  WHERE code = 'SLIDES_VISIBLE_COPY_AGENT'
    AND organization_id IS NULL
    AND version = '1.0.2'
);

UPDATE public.system_prompts
SET is_active = true
WHERE code = 'SLIDES_VISIBLE_COPY_AGENT'
  AND organization_id IS NULL
  AND version = '1.0.2';
