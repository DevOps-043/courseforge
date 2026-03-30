/**
 * Default prompts for materials generation, decomposed by component type.
 * These serve as fallbacks when no custom prompt is defined in the system_prompts table.
 *
 * Code mapping to system_prompts table:
 *   MATERIALS_SYSTEM            → systemPromptDefault
 *   MATERIALS_DIALOGUE          → dialoguePromptDefault
 *   MATERIALS_READING           → readingPromptDefault
 *   MATERIALS_QUIZ              → quizPromptDefault
 *   MATERIALS_VIDEO_THEORETICAL → videoTheoreticalPromptDefault
 *   MATERIALS_VIDEO_DEMO        → videoDemoPromptDefault
 *   MATERIALS_VIDEO_GUIDE       → videoGuidePromptDefault
 *   MATERIALS_DEMO_GUIDE        → demoGuidePromptDefault
 *   MATERIALS_EXERCISE          → exercisePromptDefault
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

export const dialoguePromptDefault = `## Diálogo Interactivo (con SofLIA)

**Cuándo:** Práctica reflexiva e iterativa con prompts guiados (actividad, no video).
**Objetivos (Bloom):** Aplicar prompts; evaluar calidad; reflexionar/mejorar (≥ 2 iteraciones válidas).

**Estructura (orientativa):**
- 00:00–01:00 Instrucción inicial
- 01:00–02:00 Escenario breve
- 02:00–08:00 Práctica guiada (3–5 prompts)
- 08:00–10:00 Cierre reflexivo

**Generación requerida:**
- Actividad de 5–9 min
- 3–5 prompts progresivos para que el usuario pregunte a SofLIA
- Consigna de reflexión final
- Registro de mejora (qué cambió y por qué entre iteraciones)

**Personajes:** "SofLIA" (instructora virtual), "Usuario" (participante)
**Tono:** Conversacional pero educativo`;

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
// MAP: prompt code → default content
// --------------------------------------------------------------------------

export const DEFAULT_PROMPTS: Record<string, string> = {
    MATERIALS_SYSTEM: systemPromptDefault,
    MATERIALS_DIALOGUE: dialoguePromptDefault,
    MATERIALS_READING: readingPromptDefault,
    MATERIALS_QUIZ: quizPromptDefault,
    MATERIALS_VIDEO_THEORETICAL: videoTheoreticalPromptDefault,
    MATERIALS_VIDEO_DEMO: videoDemoPromptDefault,
    MATERIALS_VIDEO_GUIDE: videoGuidePromptDefault,
    MATERIALS_DEMO_GUIDE: demoGuidePromptDefault,
    MATERIALS_EXERCISE: exercisePromptDefault,
};

// --------------------------------------------------------------------------
// LEGACY: Full monolithic prompt (kept for backward compatibility)
// --------------------------------------------------------------------------

export { materialsGenerationPrompt } from './materials-generation.prompts.legacy';
