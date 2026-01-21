# Análisis de Implementación Paso 5 (Materiales) vs Documentación

Este documento resume el análisis de la implementación actual del **Paso 5: Generación de Materiales** en comparación con la documentación `Documentacion Go ESP 05.md`, e incluye los prompts utilizados.

## 1. Análisis de Lógica y Estructura

La implementación sigue fielmente la arquitectura propuesta en la documentación.

### Arquitectura General

- **Controlador (Flow)**: `src/domains/materials/services/materials.service.ts` orquesta el flujo completo (Generación -> Validación -> QA). Maneja la máquina de estados (`PHASE3_GENERATING`, `PHASE3_VALIDATING`, `PHASE3_NEEDS_FIX`, etc.) tal como se especifica en el diseño.
- **Validaciones (DoD)**: `src/domains/materials/validators/materials.validators.ts` implementa los controles "DoD" (Definition of Done) mediante **código estático**, no mediante prompts de validación (LLM). Esto es más robusto y rápido.
- **Prompting**: `src/shared/config/prompts/materials.prompts.ts` contiene toda la lógica de construcción de prompts, incluyendo el "Prompt Maestro v2.4" (`prompt05`).
- **API**: `src/app/api/materials/route.ts` actúa como puente simple para llamar al modelo Generativo (Gemini).

### Comparativa de Controles DoD

| Control (Doc)               | Implementación (Código)                                                                           | Estado                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Control 3: Consistencia** | `validateOAReflected` (keywords), `validateComponentsComplete`                                    | ✅ Implementado (Lógica estática) |
| **Control 4: Fuentes**      | `validateSourcesUsage` (verifica IDs de fuentes aptas), `validateNoNonAptaSources`                | ✅ Implementado (Lógica estática) |
| **Control 5: Quiz**         | `validateQuizQuantity`, `validateQuizTypes`, `validateQuizDifficulty`, `validateQuizExplanations` | ✅ Implementado (Lógica estática) |

**Nota sobre Validaciones:** El sistema NO utiliza prompts de LLM para la validación ("Validator Agents"), sino que ejecuta funciones de validación programática sobre el JSON estructurado devuelto por la generación. Esto garantiza un cumplimiento estricto del esquema y reglas cuantificables (como número de preguntas).

---

## 2. Prompts del Sistema (Paso 5)

A continuación se presentan los prompts extraídos de `src/shared/config/prompts/materials.prompts.ts`. Estos prompts son dinámicos y se construyen inyectando el plan de la lección y las fuentes.

### 2.1 Contexto del Sistema (Base para prompts estándar)

Utilizado en `default`, `detailed`, `concise`.

```typescript
function getSystemContext(): string {
  return `Eres un diseñador instruccional experto especializado en crear materiales educativos para cursos en línea.
Tu tarea es generar contenido educativo de alta calidad basado en el plan de la lección y las fuentes proporcionadas.

REGLAS IMPORTANTES:
1. Basa TODO el contenido en las fuentes proporcionadas
2. Mantén consistencia con el Objetivo de Aprendizaje (OA)
3. Usa un tono profesional pero accesible
4. Incluye ejemplos prácticos cuando sea apropiado
5. Para los quizzes, asegura que cada pregunta tenga retroalimentación explicativa
6. Los diálogos deben ser naturales y educativos`;
}
```

### 2.2 Prompt Estándar ("Default")

Este es el prompt por defecto usado si no se selecciona el "Maestro".

```typescript
function generateDefaultPrompt(ctx: PromptContext): string {
  // ... (context injection logic) ...

  return `${getSystemContext()}

${retryContext}

# INFORMACIÓN DE LA LECCIÓN

**Módulo:** ${lesson.module_title}
**Lección:** ${lesson.lesson_title}
**Objetivo de Aprendizaje (OA):**
${lesson.oa_text}

**Componentes a generar:**
${formatComponents(lesson.components)}

${
  lesson.quiz_spec
    ? `
**Especificaciones del Quiz:**
- Cantidad de preguntas: ${lesson.quiz_spec.min_questions} a ${lesson.quiz_spec.max_questions}
- Tipos permitidos: ${lesson.quiz_spec.types?.join(", ") || "MULTIPLE_CHOICE, TRUE_FALSE"}
- Distribución de dificultad: Variada (EASY, MEDIUM, HARD)
`
    : ""
}

${lesson.requires_demo_guide ? "**NOTA:** Esta lección REQUIERE una guía de demostración paso a paso." : ""}

# FUENTES DISPONIBLES

${formatSources(sources)}

# INSTRUCCIONES

1. Genera TODOS los componentes solicitados
2. Cada componente debe estar alineado con el OA
3. Usa las fuentes proporcionadas para respaldar el contenido
4. Para el QUIZ:
   - Cada pregunta DEBE tener una explicación (feedback)
   - Varía la dificultad (mezcla EASY, MEDIUM, HARD)
   - Las opciones incorrectas deben ser plausibles
5. Para el DIALOGUE:
   - Usa personajes: "Lia" (instructora virtual) y "Usuario"
   - Mantén un tono conversacional pero educativo
6. Para READING:
   - Usa HTML válido (p, ul, ol, strong, em)
   - Incluye puntos clave (key_points)

# FORMATO DE RESPUESTA

Responde SOLO con JSON válido siguiendo este esquema:

${getOutputSchema(lesson.components)}

IMPORTANTE: No incluyas texto antes o después del JSON. Solo el JSON puro.`;
}
```

### 2.3 Prompt Maestro v2.4 ("prompt05")

Este es el prompt más complejo, diseñado para la Fase 3 de Producción.

```typescript
function generatePrompt05(ctx: PromptContext): string {
  // ... (context injection logic) ...

  return `# PROMPT 3/3 — FASE 3: Generación de materiales (Producción)

Actúa como **motor de producción instruccional** para microlearning de IA.

Estás ejecutando la **FASE 3 de 3** (Plan → Curaduría → Producción).

Tu misión en esta fase:

Generar los **materiales finales** de una lección usando el **Prompt Maestro v2.4**, a partir del plan instruccional (F1) y las fuentes curadas (F2).

---

${retryContext}

## 0. Insumos

**Lección actual:**
- lesson_id: ${lesson.lesson_id}
- lesson_title: ${lesson.lesson_title}
- module_id: ${lesson.module_id}
- module_title: ${lesson.module_title}
- oa_text: ${lesson.oa_text}
- components: ${JSON.stringify(lesson.components)}
${lesson.quiz_spec ? `- quiz_spec: { min_questions: ${lesson.quiz_spec.min_questions}, max_questions: ${lesson.quiz_spec.max_questions}, types: ${JSON.stringify(lesson.quiz_spec.types || ["MULTIPLE_CHOICE", "TRUE_FALSE"])} }` : ""}
- requires_demo_guide: ${lesson.requires_demo_guide || false}

**Fuentes curadas:**
${formatSources(sources)}

---

## 1. Reglas globales adicionales para esta fase

1. **Formato de salida**
   - **IMPORTANTE: Responde SOLO con JSON válido.**
   - No uses Markdown, tablas o texto fuera del JSON.
   - La estructura JSON debe ser exactamente la especificada en la sección de formato.

2. **Componentes obligatorios**
   - SIEMPRE debes generar:
     - **DIALOGUE** (Diálogo con Lia)
     - **READING** (Lectura de refuerzo, ~750 palabras)
     - **QUIZ** (Cuestionario formativo, 3-5 preguntas)
   - Los videos (Teórico, Demo, Guía) se generan según el plan instruccional:
     - Si el OA es **Recordar/Comprender** → puede incluir guion de Video Teórico
     - Si el OA es **≥ Aplicar** → debe incluir guion de Video Demo o Video Guía
     - Si \`requires_demo_guide: true\` → DEBE incluir DEMO_GUIDE con guion detallado

3. **Cero descargables obligatorios**
   - NO diseñes actividades que requieran descargar/subir archivos, datasets, .zip, repos, etc.
   - Todo debe ser **reproducible en pantalla** mediante texto e instrucciones.

4. **Accesibilidad**
   - Español neutro, tono profesional y cercano.
   - Contenido subtitulable; evita depender de elementos visuales no descriptibles.

5. **Coherencia Bloom ↔ contenido**
   - Respeta la combinación mínima requerida según la Matriz Bloom.
   - Revisa que el tipo de contenido generado corresponda al nivel máximo Bloom del OA.

---

## 2. Prompt Maestro v2.4 (USO INTERNO)

**Propósito:**
Guía base para generar guiones, storyboards y materiales on-demand de IA aplicable, bajo un modelo modular, claro y medible.

> Nota sobre tiempos: Son referencias para ritmo; acepta variaciones.

### 1) Video Teórico (Explicativo)
... (Definición de estructura y objetivos Bloom) ...

### 2) Video Demo (Demostrativo)
... (Definición de estructura y objetivos Bloom) ...

### 3) Video Guía (Práctica guiada)
... (Definición de estructura y objetivos Bloom) ...

### 4) Diálogo Interactivo (con Lia)
... (Definición de estructura y objetivos Bloom) ...

### 5) Lectura (Refuerzo)
... (Definición de estructura y objetivos Bloom) ...

### 6) Cuestionario Formativo (Fin de lección)
... (Definición de estructura y objetivos Bloom) ...

---

## 3. Definition of Done (FASE 3)

Considera la Fase 3 terminada solo si:

- Se generaron **todos los componentes previstos** en el plan:
  - Videos necesarios (según Bloom y plan)
  - Diálogo con Lia (SIEMPRE)
  - Lectura (Refuerzo) (SIEMPRE)
  - Cuestionario Formativo (SIEMPRE)

- No se requieren **descargables obligatorios** en ninguna actividad

- La combinación de contenidos respeta la **coherencia Bloom ↔ contenido**

- El Quiz:
  - Tiene 3–5 preguntas (según quiz_spec)
  - Incluye feedback inmediato por opción
  - Refuerza un **corte de aprobación ≥80%**

- Los guiones y storyboards:
  - Tienen timecodes coherentes
  - Describen visuales específicos
  - Siguen las estructuras del Prompt Maestro

---

## 4. Notas sobre Storyboards

### Reglas visuales por tipo:

**Video Teórico:**
- Permitido: Slides, texto en pantalla, iconografía literal, diagramas simples, B-roll temático-controlado
- Prohibido: Interfaces reales, capturas de herramientas, metáforas visuales o imágenes abstractas

**Video Demo:**
- Permitido: Capturas reales, grabación de herramienta, zoom funcional, resaltados, pantalla dividida, B-roll temático-controlado
- Prohibido: Slides conceptuales como visual principal; imágenes genéricas

**Video Guía:**
- Permitido: Capturas paso a paso, recuadros de instrucción, criterios de éxito visibles, pantalla comparativa, B-roll temático-controlado
- Prohibido: Slides conceptuales o visuales abstractos

### Sincronización:
- Cada toma del storyboard debe tener sincronía 1:1 entre visual_content y narration_text
- Los timecodes deben ser progresivos y coherentes con la duración total estimada

---

## 5. Formato de salida JSON (OBLIGATORIO)

Responde **SOLO con JSON válido** usando esta estructura exacta:

${getPrompt05OutputSchema(lesson)}

**REGLAS CRÍTICAS DEL JSON:**

1. **components** debe incluir TODOS los componentes solicitados en lesson.components.
2. **DIALOGUE, READING, QUIZ** son OBLIGATORIOS siempre.
3. **VIDEO_THEORETICAL, VIDEO_DEMO, VIDEO_GUIDE** se generan según el plan:
   - Si el OA es Recordar/Comprender → puede incluir VIDEO_THEORETICAL
   - Si el OA es ≥ Aplicar → debe incluir VIDEO_DEMO o VIDEO_GUIDE
   - Si \`requires_demo_guide: true\` → DEBE incluir DEMO_GUIDE con video_script y storyboard
4. **storyboard** arrays deben tener timecodes coherentes y progresivos.
5. **visual_content** debe describir EXACTAMENTE lo que se ve en pantalla (sin metáforas abstractas).
6. **explanation** en QUIZ es REQUERIDO para cada pregunta (feedback por opción).
7. **passing_score** en QUIZ debe ser 80.
8. **body_html** en READING debe ser HTML válido (~750 palabras).
9. **source_refs_used** debe listar los IDs de las fuentes realmente utilizadas.
10. NO uses campos adicionales fuera de los especificados.
11. NO incluyas texto fuera del JSON (ni explicaciones, ni Markdown, ni tablas).

**IMPORTANTE FINAL:** Responde SOLO con el JSON, sin texto adicional, sin Markdown, sin explicaciones fuera del JSON. El sistema parseará directamente el JSON y validará la estructura.`;
}
```

### 2.4 Prompt de Reto ("Retry Context")

Si la validación falla (aunque sea validación de código), el sistema puede re-enviar el prompt con instrucciones de corrección. Esto se inyecta al principio de los prompts anteriores:

```typescript
const retryContext = isRetry
  ? `
CONTEXTO DE ITERACIÓN:
Esta es la iteración #${iterationNumber}. Por favor corrige los siguientes problemas:
${fixInstructions || "Mejora la calidad general del contenido."}
`
  : "";
```
