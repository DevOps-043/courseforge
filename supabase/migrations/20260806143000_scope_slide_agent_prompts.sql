-- Scope system prompts so mixed flows can be managed from one prompt history UI.
-- Scopes are intentionally text values instead of an enum so new product areas can
-- be added without a blocking schema migration.

ALTER TABLE public.system_prompts
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'Cursos';

ALTER TABLE public.model_settings
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'Cursos';

CREATE INDEX IF NOT EXISTS idx_system_prompts_scope_code_org_active
  ON public.system_prompts (scope, code, organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_model_settings_scope_type_org_active
  ON public.model_settings (scope, setting_type, organization_id, is_active);

UPDATE public.system_prompts
SET scope = CASE
  WHEN upper(code) LIKE '%SLIDES_%'
    OR upper(code) LIKE '%SLIDE_DECK%'
    OR upper(code) LIKE 'SLIDE_TEMPLATE_%'
    THEN 'Modulos: Slides'
  WHEN upper(code) LIKE '%BUNDLE%'
    OR upper(code) LIKE '%BROLL%'
    OR upper(code) LIKE '%B_ROLL%'
    OR upper(code) LIKE '%CLIP_GENERATION%'
    OR upper(code) LIKE '%VIDEO_BROLL%'
    THEN 'Modulos: Bundle'
  ELSE 'Cursos'
END
WHERE scope IS NULL
  OR scope = 'Cursos';

UPDATE public.model_settings
SET scope = CASE
  WHEN upper(setting_type) LIKE 'SLIDES_%'
    OR upper(setting_type) LIKE 'SLIDE_TEMPLATE_%'
    THEN 'Modulos: Slides'
  WHEN upper(setting_type) LIKE '%BUNDLE%'
    THEN 'Modulos: Bundle'
  ELSE 'Cursos'
END
WHERE scope IS NULL
  OR scope = 'Cursos';

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
    'SLIDES_QA_AGENT'::text
  ]));

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
SELECT * FROM (VALUES
  ('gpt-4o',      'gemini-2.0-flash', 0.40::numeric, 'medium', 'Modulos: Bundle', 'BUNDLE_AGENT',                 true, NULL::uuid),
  ('gpt-4o-mini', 'gemini-2.0-flash', 0.20::numeric, 'low',    'Modulos: Slides', 'SLIDES_DECK_BRIEF_AGENT',     true, NULL::uuid),
  ('gpt-4o-mini', 'gemini-2.0-flash', 0.10::numeric, 'low',    'Modulos: Slides', 'SLIDES_EVIDENCE_AGENT',       true, NULL::uuid),
  ('gpt-4o',      'gemini-2.0-flash', 0.30::numeric, 'medium', 'Modulos: Slides', 'SLIDES_STRATEGY_AGENT',       true, NULL::uuid),
  ('gpt-4o',      'gemini-2.0-flash', 0.45::numeric, 'medium', 'Modulos: Slides', 'SLIDE_TEMPLATE_TYPE_AGENT',   true, NULL::uuid),
  ('gpt-4o-mini', 'gemini-2.0-flash', 0.30::numeric, 'low',    'Modulos: Slides', 'SLIDES_VISIBLE_COPY_AGENT',   true, NULL::uuid),
  ('gpt-4o',      'gemini-2.0-flash', 0.50::numeric, 'medium', 'Modulos: Slides', 'SLIDES_VISUAL_TEMPLATE_AGENT', true, NULL::uuid),
  ('gpt-4o-mini', 'gemini-2.0-flash', 0.10::numeric, 'low',    'Modulos: Slides', 'SLIDES_QA_AGENT',             true, NULL::uuid)
) AS v(model_name, fallback_model, temperature, thinking_level, scope, setting_type, is_active, organization_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_settings settings
  WHERE settings.setting_type = v.setting_type
    AND settings.organization_id IS NULL
    AND settings.is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDES_DECK_BRIEF_AGENT',
  'Modulos: Slides',
  '1.0.0',
  $$Objetivo:
Analizar la solicitud de diapositivas HTML y producir un brief operativo para el deck.

Entradas esperadas:
- {{componentType}}
- {{componentContentSummary}}
- {{inputMetadata}}
- {{customSlides}}

Decisiones:
- Determinar si la fuente principal es custom_request, script, storyboard o fallback.
- Estimar cantidad objetivo de slides sin exceder el contrato del renderer HTML.
- Identificar titulo, idioma, template y restricciones de salida.

Reglas:
- No inventes fuentes ni datos.
- No confundas ritmo/duracion de video con informacion instruccional.
- Devuelve decisiones concisas, auditables y aptas para ser usadas por agentes posteriores.$$,
  'Agente de brief para decks HTML de SofLIA Engine Slides',
  true,
  'SEED',
  'Seed inicial para agentes configurables de slides HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDES_DECK_BRIEF_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDES_EVIDENCE_AGENT',
  'Modulos: Slides',
  '1.0.0',
  $$Objetivo:
Construir un paquete de evidencia trazable para las diapositivas HTML de una leccion.

Entradas esperadas:
- {{component}}
- {{curatedSources}}
- {{materialClaims}}

Decisiones:
- Detectar source_refs disponibles sin inventar referencias.
- Priorizar fuentes aprobadas y cercanas a la leccion.
- Marcar claims relevantes que deben conservar trazabilidad.

Reglas:
- Si no hay fuentes suficientes, reporta ausencia de evidencia; no rellenes con referencias falsas.
- Usa identificadores estables y cortos.
- Mantén la evidencia separada del texto visible de la slide.$$,
  'Agente de evidencia y trazabilidad para slides HTML',
  true,
  'SEED',
  'Seed inicial para agentes configurables de slides HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDES_EVIDENCE_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDES_STRATEGY_AGENT',
  'Modulos: Slides',
  '1.0.1',
  $$Objetivo:
Seleccionar los tipos de diapositiva que debe usar una leccion antes de renderizar HTML.

Entradas esperadas:
- {{deckBrief}}
- {{evidencePack}}
- {{scriptSections}}
- {{storyboardItems}}
- {{curatedSources}}

Tipos permitidos:
cover, objectives, concept, worked_example, exercise, knowledge_check, summary, data_explainer, diagram, quote, transition.

Reglas:
- Usa el guion para inferir secuencia, intencion pedagogica y tipo de slide; no lo conviertas en transcripcion visible.
- El contenido visible debe mapearse a fuentes curadas o claims ya respaldados por evidencia.
- Usa data_explainer solo cuando existan datos pedagogicos reales, no duraciones ni timecodes del video.
- Usa worked_example cuando la informacion implique aplicacion, pasos, demo o ejemplo.
- Usa knowledge_check cuando existan preguntas, errores comunes, evaluacion o reflexion comprobable.
- Mantén una slide por idea principal cuando sea posible.$$,
  'Agente de estrategia para seleccionar tipos de slides HTML',
  true,
  'SEED',
  'Seed inicial para agentes configurables de slides HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDES_STRATEGY_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDE_TEMPLATE_TYPE_AGENT',
  'Modulos: Slides',
  '1.0.0',
  $$Objetivo:
Actuar como arquitecto generativo de tipos de diapositiva para plantillas HTML SofLIA Deck.

Responsabilidad:
Decidir si la solicitud del usuario se cubre con tipos base existentes o si requiere crear nuevos tipos de diapositiva bajo contrato.

Entradas esperadas:
- {{conversationMessages}}
- {{baseSlideTypes}}
- {{supportedLayouts}}
- {{designIntent}}
- {{lessonContext}}

Tipos base recomendados:
cover, objectives, concept, explanation, worked_example, exercise, knowledge_check, summary, data_explainer, diagram, bibliography, quote, transition.

Layouts soportados por el renderer HTML:
center, closing, data, framework, split, split_reverse.

Contrato obligatorio para cada tipo:
{
  "id": "snake_case_ascii",
  "label": "Nombre visible",
  "purpose": "Para que sirve este tipo en la leccion",
  "defaultLayout": "center | closing | data | framework | split | split_reverse",
  "requiredContent": ["campo_requerido"]
}

Reglas:
- Reutiliza un tipo base cuando encaje semanticamente.
- Crea un tipo nuevo solo cuando ningun tipo base represente bien la actividad pedagogica o la estructura visual solicitada.
- El id debe usar snake_case ASCII, empezar con letra y no exceder 48 caracteres.
- No crees layouts nuevos; asigna cada tipo a un layout soportado.
- Usa data_explainer solo si hay datos de la leccion que justifiquen grafica. Nunca uses duraciones, timecodes o ritmo del video como datos de grafica.
- No copies la narracion del avatar como contenido visible.
- Prefiere pocos tipos claros antes que muchos tipos redundantes.
- Cada tipo debe poder renderizarse como HTML 16:9 sin depender de animaciones para revelar contenido.

Salida esperada:
Devuelve exclusivamente JSON valido:
{
  "slideTypes": [
    {
      "id": "string",
      "label": "string",
      "purpose": "string",
      "defaultLayout": "center",
      "requiredContent": ["string"]
    }
  ],
  "rationale": "Resumen breve de decisiones"
}$$,
  'Agente generativo para crear o seleccionar tipos de diapositivas en plantillas HTML',
  true,
  'SEED',
  'Seed inicial para agente generativo de tipos de plantillas HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDE_TEMPLATE_TYPE_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDES_VISIBLE_COPY_AGENT',
  'Modulos: Slides',
  '1.0.1',
  $$Objetivo:
Definir el texto visible de cada slide HTML usando evidencia curada de la leccion, sin duplicar la narracion del avatar.

Entradas esperadas:
- {{sourcePack}}
- {{sourceRefs}}
- {{sourceExcerpts}}
- {{onScreenText}}
- {{visualNotes}}
- {{onScreenAction}}
- {{successCriteria}}
- {{narrationText}}

Reglas:
- El contenido visible debe salir de fuentes investigadas y aprobadas para la leccion.
- No investigues de nuevo ni agregues datos que no esten en las fuentes disponibles.
- Usa los extractos reales de las fuentes para sintetizar conceptos, ejemplos, practicas, verificaciones o resumen segun el tipo de slide.
- La salida visible debe estar principalmente en espanol neutro aunque la fuente original este en otro idioma.
- Usa el guion solo para inferir tipo de slide, secuencia, intencion pedagogica y speakerNotes.
- La narracion del avatar va en speakerNotes, no en contenido visible.
- No menciones "guion", "storyboard", "B-roll", "avatar", "timecode" ni instrucciones de produccion en pantalla.
- Si no hay fuente suficiente para una afirmacion, marca el contenido como pendiente de sintetizar desde fuentes aprobadas.
- Limita cada slide a titulo breve y hasta cuatro bullets.
- Evita parrafos largos y transcripciones completas.$$,
  'Agente de copy visible para slides HTML',
  true,
  'SEED',
  'Seed inicial source-first para copy visible de slides HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDES_VISIBLE_COPY_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDES_VISUAL_TEMPLATE_AGENT',
  'Modulos: Slides',
  '1.0.0',
  $$Objetivo:
Asignar layout y direccion visual a cada slide HTML segun su tipo, proposito y evidencia.

Layouts permitidos:
center, closing, data, framework, split, split_reverse.

Reglas:
- cover, quote y transition usan center.
- summary usa closing.
- data_explainer usa data cuando tiene grafica instruccional valida.
- objectives, exercise, knowledge_check y diagram usan framework si tienen elementos suficientes.
- worked_example con fuentes/evidencia usa split_reverse para reforzar el apoyo visual.
- concept usa split por defecto.
- No uses layouts que oculten texto ni dependan de animaciones para revelar contenido.$$,
  'Agente de seleccion visual y layout para slides HTML',
  true,
  'SEED',
  'Seed inicial para agentes configurables de slides HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDES_VISUAL_TEMPLATE_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);

INSERT INTO public.system_prompts (code, scope, version, content, description, is_active, source, change_summary)
SELECT
  'SLIDES_QA_AGENT',
  'Modulos: Slides',
  '1.0.0',
  $$Objetivo:
Validar que el deck HTML sea seguro, legible, pedagogico y apto para exportacion.

Checklist:
- HTML sin scripts arbitrarios ni assets remotos no controlados.
- Fuentes compatibles con acentos y caracteres en espanol.
- Animaciones no deben ocultar titulos ni bullets.
- Narracion del avatar no debe aparecer como contenido visible.
- Graficas solo si representan informacion de la leccion, nunca ritmo/duracion del video.
- Orden, densidad de texto y contrato de render deben ser validos.

Salida esperada:
Reporta findings con severidad, codigo, slideId y mensaje accionable.$$,
  'Agente de QA para decks HTML de SofLIA Engine Slides',
  true,
  'SEED',
  'Seed inicial para agentes configurables de slides HTML'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_prompts
  WHERE code = 'SLIDES_QA_AGENT'
    AND organization_id IS NULL
    AND is_active = true
);
