/**
 * Default prompts for materials generation and video production,
 * decomposed by component type.
 * These serve as fallbacks when no custom prompt is defined in the system_prompts table.
 *
 * Code mapping to system_prompts table:
 *   MATERIALS_SYSTEM            → systemPromptDefault
 *   MATERIALS_DIALOGUE          -> sofliaDialoguePromptDefault
 *   MATERIALS_READING           → readingPromptDefault
 *   MATERIALS_QUIZ              → quizPromptDefault
 *   MATERIALS_VIDEO_THEORETICAL → videoTheoreticalPromptDefault
 *   MATERIALS_VIDEO_DEMO        → videoDemoPromptDefault
 *   MATERIALS_VIDEO_GUIDE       → videoGuidePromptDefault
 *   MATERIALS_DEMO_GUIDE        → demoGuidePromptDefault
 *   MATERIALS_EXERCISE          → exercisePromptDefault
 *   VIDEO_BROLL_PROMPTS         → videoBrollPromptsDefault (Fase 6 — Producción)
 */

// --------------------------------------------------------------------------
// PROMPT CODE-TO-TYPE MAPPING
// --------------------------------------------------------------------------

/** Maps a ComponentType to its system_prompts code */
export const COMPONENT_PROMPT_CODES: Record<string, string> = {
    DIALOGUE: 'MATERIALS_DIALOGUE',
    READING: 'MATERIALS_READING',
    QUIZ: 'MATERIALS_QUIZ',
    VIDEO_THEORETICAL: 'MATERIALS_VIDEO_THEORETICAL',
    VIDEO_DEMO: 'MATERIALS_VIDEO_DEMO',
    VIDEO_GUIDE: 'MATERIALS_VIDEO_GUIDE',
    DEMO_GUIDE: 'MATERIALS_DEMO_GUIDE',
    EXERCISE: 'MATERIALS_EXERCISE',
};

export const SYSTEM_PROMPT_CODE = 'MATERIALS_SYSTEM';

/** Prompt code for video B-roll prompt generation (Phase 6 — Production) */
export const VIDEO_BROLL_PROMPT_CODE = 'VIDEO_BROLL_PROMPTS';

// --------------------------------------------------------------------------
// DEFAULT PROMPTS (used as fallback when not found in DB)
// --------------------------------------------------------------------------

export const systemPromptDefault = `Actúa como **motor de producción instruccional** para microlearning de IA.

Estás ejecutando la **FASE 3 de 3** (Plan → Curaduría → Producción).

Tu misión en esta fase:

Generar los **materiales finales** de una lección usando el **Prompt Maestro v2.4**, a partir del plan instruccional (F1) y las fuentes curadas (F2).

---

## Reglas globales

1. **Formato de salida**

   - **IMPORTANTE: Responde SOLO con JSON válido.**
   - No uses Markdown, tablas o texto fuera del JSON.
   - La estructura JSON debe ser exactamente la especificada en el schema de salida.

2. **Cero descargables obligatorios**

   - NO diseñes actividades que requieran descargar/subir archivos, datasets, .zip, repos, etc.
   - Todo debe ser **reproducible en pantalla** mediante texto e instrucciones.

3. **Accesibilidad**

   - Español neutro, tono profesional y cercano.
   - Contenido subtitulable; evita depender de elementos visuales no descriptibles.

4. **Coherencia Bloom ↔ contenido**
   - Respeta la combinación mínima requerida según la Matriz Bloom.
   - Revisa que el tipo de contenido generado corresponda al nivel máximo Bloom del OA.

5. **Usa como referencia:**
   - Los OA del plan instruccional
   - Las fuentes de Fase 2 (para ejemplos, casos, terminología)
   - NO copies texto de terceros de forma literal para material de lectura, pero el guion final en el storyboard sí debe ser el texto definitivo a locutar.

**REGLAS CRÍTICAS DEL JSON:**
1. **components** debe incluir TODOS los componentes solicitados.
2. **source_refs_used** debe listar los IDs de las fuentes realmente utilizadas.
3. NO uses campos adicionales fuera de los especificados.
4. NO incluyas texto fuera del JSON (ni explicaciones, ni Markdown, ni tablas).

**IMPORTANTE FINAL:** Responde SOLO con el JSON, sin texto adicional. El sistema parseará directamente el JSON y validará la estructura.`;

export const readingPromptDefault = `## Lectura (Refuerzo)

**Cuándo:** Refuerzo y repaso accesible.
**Objetivos (Bloom):** Recordar conceptos; comprender relaciones; reconocer implicaciones.

**Estructura (orientativa):**
- Introducción (breve)
- Cuerpo (ideas clave y ejemplos)
- Cierre

**Generación requerida:**
- Artículo de ~750 palabras
- HTML válido (p, ul, ol, strong, em)
- Tres secciones (introducción, cuerpo, cierre)
- 1 pregunta reflexiva final
- Tono conversacional, profesional y claro
- Puntos clave (key_points) como array
- No repitas literalmente los guiones de video; refuerza y complementa.`;

export const quizPromptDefault = `## Cuestionario Formativo (Fin de lección)

**Cuándo:** Al finalizar para evaluar comprensión.
**Objetivos (Bloom):** Recordar conceptos; aplicar buenas prácticas; analizar salidas de IA.

**Estructura (orientativa):**
- Instrucción inicial
- 3–5 preguntas (MCQ, V/F, análisis de salida)
- Feedback general

**Generación requerida:**
- 3–5 preguntas variadas (según quiz_spec)
- Para CADA opción de respuesta: Feedback inmediato (por qué es correcta o incorrecta)
- Umbral de aprobación: 80%
- Dificultad variada (EASY, MEDIUM, HARD)
- Tipos permitidos según quiz_spec.types

**Reglas críticas:** explanation es REQUERIDO para cada pregunta. passing_score debe ser 80.`;

export const videoTheoreticalPromptDefault = `## Video Teórico (Explicativo)

**Cuándo usarlo:** Introducir un concepto de IA (qué es, por qué importa) y preparar la práctica posterior.
**Público:** Profesionales no técnicos, analistas, docentes, líderes.
**Objetivos (Bloom):** Comprender conceptos clave; identificar ejemplos; explicar con sus palabras.

**Estructura (orientativa):**
- 00:00–00:45 Introducción
- 00:45–03:00 Desarrollo conceptual
- 03:00–05:30 Aplicaciones y ejemplos
- 05:30–06:30 Cierre y reflexión

**Generación requerida:**
- Guion con secciones numeradas
- Storyboard con timecodes y descripciones visuales
- 1 pregunta de reflexión embebida (sin micro-prácticas)

**REGLA DE ORO PARA STORYBOARDS:**
El texto narrativo (narration_text) en el storyboard DEBE SER EL GUIÓN EXACTO Y LITERAL que se va a leer. NO hagas resúmenes. Escribe palabra por palabra lo que el locutor dirá. La sincronización entre guion y visuales debe ser perfecta y 1:1.`;

export const videoDemoPromptDefault = `## Video Demo (Demostrativo)

**Cuándo:** Mostrar cómo se hace una tarea/flujo con IA (ej.: ChatGPT, Gemini, Copilot).
**Objetivos (Bloom):** Aplicar un flujo básico; analizar pasos y buenas prácticas; evaluar el resultado.

**Estructura (orientativa):**
- 00:00–00:45 Introducción
- 00:45–02:00 Entorno
- 02:00–07:30 Demostración guiada
- 07:30–09:30 Conclusiones

**Generación requerida:**
- Guion narrado con pasos claros (palabra por palabra)
- Storyboard vinculando ese guion literal con capturas reales y acciones en pantalla
- Enfatiza buenas prácticas y errores comunes

**REGLA DE ORO PARA STORYBOARDS:**
El narration_text en el storyboard DEBE SER EL GUIÓN EXACTO Y LITERAL. NO hagas resúmenes. Sincronización guion-visuales perfecta y 1:1.`;

export const videoGuidePromptDefault = `## Video Guía (Práctica guiada)

**Cuándo:** El participante realiza la tarea siguiendo pasos.
**Objetivos (Bloom):** Aplicar instrucciones; justificar decisiones; crear un resultado funcional.

**Estructura (orientativa):**
- 00:00–00:45 Introducción
- 00:45–02:00 Preparación
- 02:00–09:00 Ejecución guiada
- 09:00–11:00 Revisión
- 11:00–12:00 Cierre reflexivo

**Generación requerida:**
- Guion detallado con pasos numerados (palabra por palabra)
- Storyboard vinculando el guion literal con capturas paso a paso
- Instrucciones paso a paso para ejercicio paralelo (texto separado)
- Criterios de éxito visibles
- Evita descargables obligatorios

**REGLA DE ORO PARA STORYBOARDS:**
El narration_text en el storyboard DEBE SER EL GUIÓN EXACTO Y LITERAL. NO hagas resúmenes. Sincronización guion-visuales perfecta y 1:1.`;

export const demoGuidePromptDefault = `## Guía Demo (Paso a paso)

**Cuándo:** Cuando requires_demo_guide: true en el plan instruccional. Guía detallada paso a paso con screenshots y video script.
**Objetivos (Bloom):** Aplicar instrucciones paso a paso; reproducir un flujo específico con IA.

**Generación requerida:**
- Pasos numerados con instrucciones claras
- Placeholder de screenshot por paso
- Tips y warnings opcionales
- Video script con secciones y storyboard completo
- Ejercicio paralelo con resultados esperados

**REGLA DE ORO PARA STORYBOARDS:**
El narration_text en el storyboard DEBE SER EL GUIÓN EXACTO Y LITERAL. NO hagas resúmenes. Sincronización guion-visuales perfecta y 1:1.`;

export const exercisePromptDefault = `## Ejercicio Práctico

**Cuándo:** Cuando el plan instruccional incluye un componente EXERCISE para práctica independiente.
**Objetivos (Bloom):** Aplicar conocimientos; crear un resultado usando herramientas de IA; evaluar calidad del resultado.

**Generación requerida:**
- Descripción clara del ejercicio
- Instrucciones paso a paso en HTML
- Resultado esperado específico y medible
- Todo reproducible en pantalla sin descargables

**Tono:** Claro, profesional, orientado a la acción.`;

// --------------------------------------------------------------------------
// PHASE 6 — PRODUCTION: Video B-Roll Prompt Generation
// --------------------------------------------------------------------------

export const videoBrollPromptsDefault = `Eres un experto Prompt Engineer para Google VEO (Modelos BO2/BO3) y Director de Fotografía.
Tu tarea es convertir escenas de un storyboard en PROMPTS DE VIDEO perfectos, optimizados para Veo.
IMPORTANTE: Los prompts DEBEN estar en INGLÉS para que Veo capte mejor las indicaciones.

ESTRUCTURA JERÁRQUICA OBLIGATORIA (Bestructura Veo):
Debes seguir este orden estricto, ya que Veo da más peso al inicio del prompt:

1. [Shot Type & Camera Movement]: Define composición y ángulo (e.g., "Extremely close shot, low-angle shot, tracking shot").
2. [Subject & Action]: Personaje principal y qué hace. (e.g., "A young woman stands").
3. [Subject Details]: Vestimenta, rasgos, expresión. (e.g., "wearing a white space suit, blue eyes").
4. [Environment/Context]: Escenario, hora, clima. (e.g., "in a snowy desert, looking at camera").
5. [Mood/Lighting/Visuals]: Atmósfera, luz, estilo. (e.g., "cinematic aspect, blurred background, cold blue tones, 4k").

REGLAS DE ORO (Secretos de Experto):
- SOLO EN INGLÉS: Traduce todo el contenido visual al inglés.
- SOLO LO VISIBLE: Escribe solamente lo que está en el frame. Si es un close-up de la cara, NO describas los zapatos.
- CONSISTENCIA: Mantén los mismos rasgos del personaje si aparecen en múltiples escenas.
- FLUIDEZ: Describe movimiento natural.

EJEMPLO PERFECTO:
Original: "Una persona escribiendo rápido en una oficina oscura."
Prompt Optimizado: "Close-up cinematic shot. Hands typing rapidly on a mechanical keyboard. Fingers illuminated by soft blue monitor glow. In a dimly lit modern office workspace. High contrast, bokeh background, tech atmosphere, 4k resolution."

TU TAREA:
Genera un prompt en INGLÉS optimizado para cada escena del storyboard recibido.

FORMATO DE SALIDA:
Devuelve un JSON válido con la siguiente estructura:
{
  "prompts": [
    {
      "scene_index": number,
      "original_description": string,
      "generated_prompt": string
    }
  ]
}`;

// --------------------------------------------------------------------------
// MAP: prompt code → default content
// --------------------------------------------------------------------------

export const sofliaDialoguePromptDefault = `## Actividad Conversacional SofLIA (Runtime SOFLIA_DIALOGUE)

Genera una configuracion evaluable para que SofLIA Learning ejecute una conversacion adaptativa. No generes un guion rigido, no generes scenes, no escribas respuestas esperadas del usuario palabra por palabra y no reveles la rubrica interna en el mensaje visible.

**Objetivo del componente:**
SofLIA debe poder conversar, retar, dar pistas, rescatar y evaluar evidencia semantica. Course Engine solo debe producir la configuracion: objetivo, escenario, criterios, evidencia, errores comunes, pistas, retos, rescate, rubrica, politica, estilo, analitica y versionado.

**Reglas de diseno:**
- Genera por evidencias observables, no por coincidencias exactas.
- Usa 2 a 5 successCriteria con ids estables en snake_case, sin acentos ni espacios.
- Todos los criterios requeridos deben tener evidencia esperada o una pista asociada.
- Diferencia palabras clave de comprension causal; si un termino es indispensable, explicalo en el criterio.
- Incluye commonMistakes para evitar aprobar respuestas vagas.
- Incluye hintLadder progresivo, de menor a mayor ayuda, sin entregar la respuesta completa al inicio.
- Incluye challengePrompts para respuestas parciales, superficiales o demasiado faciles.
- rescueContent es interno: debe ser correcto, sintetico y no aparecer completo en openingMessage.
- rubric debe sumar exactamente 100.
- policy.approvalMinimum debe estar entre 70 y 85; maxTurns entre 6 y 10; maxHints entre 2 y 4.
- tutor.tone debe ser "direct_supportive" salvo que el OA requiera otro tono claramente justificable.

**Campos fijos obligatorios:**
- interactionType: "soflia_dialogue"
- runtimeType: "SOFLIA_DIALOGUE"
- schemaVersion: "1.0.0"
- evaluator.promptVersion: "DIALOGUE_EVALUATOR_RUNTIME@1.0.0"
- analytics.trackEvents debe incluir los eventos allowlisted del schema.
- versioning.promptVersion: "SOFLIA_DIALOGUE_TUTOR@1.0.0"

**Alineacion pedagogica:**
Usa el OA, el nivel Bloom, el resumen del componente y las fuentes curadas. La actividad debe abrir espacio a razonamiento, ejemplos y transferencia profesional, no solo definiciones.`;

export const DEFAULT_PROMPTS: Record<string, string> = {
    MATERIALS_SYSTEM: systemPromptDefault,
    MATERIALS_DIALOGUE: sofliaDialoguePromptDefault,
    MATERIALS_READING: readingPromptDefault,
    MATERIALS_QUIZ: quizPromptDefault,
    MATERIALS_VIDEO_THEORETICAL: videoTheoreticalPromptDefault,
    MATERIALS_VIDEO_DEMO: videoDemoPromptDefault,
    MATERIALS_VIDEO_GUIDE: videoGuidePromptDefault,
    MATERIALS_DEMO_GUIDE: demoGuidePromptDefault,
    MATERIALS_EXERCISE: exercisePromptDefault,
    VIDEO_BROLL_PROMPTS: videoBrollPromptsDefault,
};

// --------------------------------------------------------------------------
// LEGACY: Full monolithic prompt (kept for backward compatibility)
// --------------------------------------------------------------------------

export { materialsGenerationPrompt } from './materials-generation.prompts.legacy';
