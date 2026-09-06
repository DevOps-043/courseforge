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
import { GLOBAL_VIDEO_DURATION_PROMPTS } from "./global-video-duration.prompts";

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

export const NO_AI_SLOP_MATERIALS_RULES = `## Filtro editorial anti AI slop

Aplica este filtro antes de entregar el JSON final. Conserva el objetivo pedagogico, la voz profesional de SofLIA y los datos de las fuentes; edita solo lo necesario para que el material suene humano, concreto y util.

Reglas:
- Escribe directo. Elimina aperturas genericas como "es importante destacar", "en el mundo actual", "hoy en dia", "en este articulo" o "vamos a explorar".
- No uses grandilocuencia ni relleno: evita "transformador", "paradigma", "vanguardia", "robusto", "meticuloso", "multifacetico", "crucial", "fundamental", "aprovechar", "potenciar", "facilitar" y sinonimos inflados si una palabra simple basta.
- No atribuyas sin fuente. Evita "expertos dicen", "estudios muestran", "se considera ampliamente" o afirmaciones equivalentes si no vienen de una fuente curada incluida en DATOS DE ENTRADA.
- Usa sujetos humanos y verbos directos cuando sea posible. Prefiere "el estudiante compara dos enfoques" sobre "se facilita la comparacion de enfoques".
- Evita cierres falsamente profundos, moralejas decorativas y recapitulaciones tipo "en conclusion". Termina con una accion, criterio, pregunta o punto concreto.
- Repite el termino correcto cuando sea necesario. No alternes "modelo", "sistema", "herramienta", "agente" o "solucion" solo para variar estilo.
- No inventes datos, cifras, ejemplos, autores, fechas, herramientas, enlaces ni citas. Si falta evidencia en las fuentes, mantente conceptual y marca el alcance con precision.
- Cada frase debe aportar una definicion, paso, criterio, ejemplo, contraste, advertencia o decision pedagogica.
- Manten el contenido claro sin aplanarlo: puede ser cercano, pero no promocional ni dramatico.

Autoevaluacion interna antes de responder:
1. El texto conserva el OA y no agrega claims externos.
2. Las fuentes citadas en source_refs_used existen en DATOS DE ENTRADA.
3. No quedan patrones de relleno, grandilocuencia, atribucion vaga, sinonimos rotados ni finales decorativos.
4. El JSON sigue exactamente el schema solicitado.`;

/** Prompt code for video B-roll prompt generation (Phase 6 — Production) */
export const VIDEO_BROLL_PROMPT_CODE = 'VIDEO_BROLL_PROMPTS';

/** Prompt code for new external video clip generator prompts (Phase 6 — Production) */
export const CLIP_GENERATION_PROMPT_CODE = 'CLIP_GENERATION_PROMPTS';

// --------------------------------------------------------------------------
// DEFAULT PROMPTS (used as fallback when not found in DB)
// --------------------------------------------------------------------------

export const systemPromptDefault = GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_SYSTEM;

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
- Umbral de aprobación: 60%
- Dificultad variada (EASY, MEDIUM, HARD)
- Tipos permitidos según quiz_spec.types

**Reglas críticas:**
- explanation es REQUERIDO para cada pregunta.
- passing_score debe ser 60.
- correct_answer es REQUERIDO para cada pregunta. En TRUE_FALSE debe ser exactamente "Verdadero" o "Falso", coherente con las opciones.
- Las opciones deben ser texto limpio. NO incluyas prefijos, letras, numeros, bullets ni etiquetas como "A.", "B)", "C -", "1." dentro de cada opcion; el frontend rotula las opciones.
- Cada opcion debe contener contenido pedagogico sustantivo. Nunca generes opciones que sean solo "A", "B", "C", "D", numeros, etiquetas vacias o placeholders.`;

export const videoTheoreticalPromptDefault = GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_VIDEO_THEORETICAL;

export const videoDemoPromptDefault = GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_VIDEO_DEMO;

export const videoGuidePromptDefault = GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_VIDEO_GUIDE;

export const demoGuidePromptDefault = GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_DEMO_GUIDE;

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

export const clipGenerationPromptsDefault = GLOBAL_VIDEO_DURATION_PROMPTS.CLIP_GENERATION_PROMPTS;

export const videoBrollPromptsDefault = GLOBAL_VIDEO_DURATION_PROMPTS.VIDEO_BROLL_PROMPTS;

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
    CLIP_GENERATION_PROMPTS: clipGenerationPromptsDefault,
};

// --------------------------------------------------------------------------
// LEGACY: Full monolithic prompt (kept for backward compatibility)
// --------------------------------------------------------------------------

export { materialsGenerationPrompt } from './materials-generation.prompts.legacy';
