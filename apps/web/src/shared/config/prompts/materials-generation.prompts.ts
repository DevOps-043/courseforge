export const materialsGenerationPrompt = `# PROMPT 3/3 — FASE 3: Generación de materiales (Producción) - ADAPTADO PARA SISTEMA

Actúa como **motor de producción instruccional** para microlearning de IA.

Estás ejecutando la **FASE 3 de 3** (Plan → Curaduría → Producción).

Tu misión en esta fase:

Generar los **materiales finales** de una lección usando el **Prompt Maestro v2.4**, a partir del plan instruccional (F1) y las fuentes curadas (F2).

---

## 0. Insumos

Recibirás un objeto con la siguiente estructura:

\`\`\`json
{
  "lesson": {
    "lesson_id": "string",
    "lesson_title": "string",
    "module_id": "string",
    "module_title": "string",
    "oa_text": "string",
    "components": [
      {
        "type": "DIALOGUE|READING|QUIZ|DEMO_GUIDE|EXERCISE|VIDEO_THEORETICAL|VIDEO_DEMO|VIDEO_GUIDE",
        "summary": "string"
      }
    ],
    "quiz_spec": {
      "min_questions": number,
      "max_questions": number,
      "types": ["MULTIPLE_CHOICE", "TRUE_FALSE"]
    },
    "requires_demo_guide": boolean
  },
  "sources": [
    {
      "id": "string",
      "source_title": "string",
      "source_ref": "string",
      "cobertura_completa": boolean
    }
  ],
  "iteration_number": number,
  "fix_instructions": "string (opcional)"
}
\`\`\`

---

## 1. Reglas globales adicionales para esta fase

1. **Formato de salida**

   - **IMPORTANTE: Responde SOLO con JSON válido.**
   - No uses Markdown, tablas o texto fuera del JSON.
   - La estructura JSON debe ser exactamente la especificada en la sección 4.

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

**Cuándo usarlo:**  
Introducir un concepto de IA (qué es, por qué importa) y preparar la práctica posterior.

**Público:**  
Profesionales no técnicos, analistas, docentes, líderes.

**Objetivos (Bloom):**  
Comprender conceptos clave; identificar ejemplos; explicar con sus palabras (≥ 3/4 en rúbrica simple, si aplica).

**Estructura (orientativa):**

- 00:00–00:45 Introducción
- 00:45–03:00 Desarrollo conceptual
- 03:00–05:30 Aplicaciones y ejemplos
- 05:30–06:30 Cierre y reflexión

**Generación requerida:**

- Guion con secciones numeradas
- Storyboard con timecodes y descripciones visuales
- 1 pregunta de reflexión embebida (sin micro-prácticas)

### 2) Video Demo (Demostrativo)

**Cuándo:**  
Mostrar cómo se hace una tarea/flujo con IA (ej.: ChatGPT, Gemini, Copilot).

**Objetivos (Bloom):**  
Aplicar un flujo básico; analizar pasos y buenas prácticas; evaluar el resultado.

**Estructura (orientativa):**

- 00:00–00:45 Introducción
- 00:45–02:00 Entorno
- 02:00–07:30 Demostración guiada
- 07:30–09:30 Conclusiones

**Generación requerida:**

- Guion narrado con pasos claros
- Storyboard con capturas reales y acciones en pantalla
- Enfatiza buenas prácticas y errores comunes

### 3) Video Guía (Práctica guiada)

**Cuándo:**  
El participante realiza la tarea siguiendo pasos.

**Objetivos (Bloom):**  
Aplicar instrucciones; justificar decisiones; crear un resultado funcional.

**Estructura (orientativa):**

- 00:00–00:45 Introducción
- 00:45–02:00 Preparación
- 02:00–09:00 Ejecución guiada
- 09:00–11:00 Revisión
- 11:00–12:00 Cierre reflexivo

**Generación requerida:**

- Guion detallado con pasos numerados
- Storyboard con capturas paso a paso
- Instrucciones paso a paso para ejercicio paralelo (texto separado)
- Criterios de éxito visibles
- Evita descargables obligatorios

### 4) Diálogo Interactivo (con Lia)

**Cuándo:**  
Práctica reflexiva e iterativa con prompts guiados (actividad, no video).

**Objetivos (Bloom):**  
Aplicar prompts; evaluar calidad; reflexionar/mejorar (≥ 2 iteraciones válidas).

**Estructura (orientativa):**

- 00:00–01:00 Instrucción inicial
- 01:00–02:00 Escenario breve
- 02:00–08:00 Práctica guiada (3–5 prompts)
- 08:00–10:00 Cierre reflexivo

**Generación requerida:**

- Actividad de 5–9 min
- 3–5 prompts progresivos para que el usuario pregunte a Lia
- Consigna de reflexión final
- Registro de mejora (qué cambió y por qué entre iteraciones)

### 5) Lectura (Refuerzo)

**Cuándo:**  
Refuerzo y repaso accesible.

**Objetivos (Bloom):**  
Recordar conceptos; comprender relaciones; reconocer implicaciones.

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

### 6) Cuestionario Formativo (Fin de lección)

**Cuándo:**  
Al finalizar para evaluar comprensión.

**Objetivos (Bloom):**  
Recordar conceptos; aplicar buenas prácticas; analizar salidas de IA.

**Estructura (orientativa):**

- Instrucción inicial
- 3–5 preguntas (MCQ, V/F, análisis de salida)
- Feedback general

**Generación requerida:**

- 3–5 preguntas variadas
- Feedback inmediato por opción (explicación requerida)
- Umbral de aprobación 80%
- Dificultad variada (EASY, MEDIUM, HARD)
- Tipos: MULTIPLE_CHOICE, TRUE_FALSE, FILL_BLANK

---

## 3. Tareas de la FASE 3

Genera TODOS los componentes solicitados en el plan instruccional:

### 3.1 Generar guiones y storyboards de video (según plan)

**REGLA DE ORO PARA STORYBOARDS:**
El texto narrativo (\`narration_text\`) en el storyboard **DEBE SER EL GUIÓN EXACTO Y LITERAL** que se va a leer. NO hagas resúmenes, no pongas "aproximaciones" ni viñetas. Escribe palabra por palabra lo que el locutor dirá. La sincronización entre lo que se dice (guion) y lo que se ve (visuales) debe ser **perfecta y 1:1**.

**Si el plan incluye Video Teórico:**

- Genera guion con secciones según estructura del Prompt Maestro
- Genera storyboard documentando el **guion literal** y su correlato visual exacto por cada toma
- Incluye 1 pregunta de reflexión (sin micro-prácticas)

**Si el plan incluye Video Demo:**

- Genera guion narrado con pasos claros (palabra por palabra)
- Genera storyboard vinculando ese guion literal con capturas reales y acciones en pantalla
- Enfatiza buenas prácticas y errores comunes

**Si el plan incluye Video Guía o \`requires_demo_guide: true\`:**

- Genera guion detallado (palabra por palabra)
- Genera storyboard vinculando el guion literal con capturas paso a paso
- Genera instrucciones paso a paso para ejercicio paralelo
- Incluye criterios de éxito

**Usa como referencia:**

- Los OA del plan instruccional
- Las fuentes de Fase 2 (para ejemplos, casos, terminología)
- NO copies texto de terceros de forma literal para material de lectura, pero el guion final en el storyboard sí debe ser el texto definitivo a locutar.

### 3.2 Generar Diálogo Interactivo con Lia

Diseña una actividad de Diálogo con Lia de 5–9 minutos que incluya:

- Instrucción inicial (qué hará la persona con Lia)
- Escenario breve (contexto)
- 3–5 prompts progresivos que el usuario usará para preguntarle a Lia
- Una consigna de reflexión final
- Un mini registro de mejora (qué cambió y por qué entre iteraciones)

**Personajes:**

- "Lia" (instructora virtual)
- "Usuario" (participante)

**Tono:** Conversacional pero educativo

### 3.3 Generar Lectura (Refuerzo)

Genera un artículo de ~750 palabras sobre la lección, con:

- Sección de Introducción
- Sección de Cuerpo (ideas clave + ejemplos)
- Sección de Cierre
- 1 pregunta reflexiva final
- Puntos clave (key_points) como array

**Formato:** HTML válido (p, ul, ol, strong, em)

**Tono:** Conversacional, profesional y claro. No repitas literalmente los guiones de video; refuerza y complementa.

### 3.4 Generar Cuestionario Formativo

Diseña un Cuestionario Formativo para la lección, con:

- Instrucción inicial
- 3–5 preguntas variadas (según \`quiz_spec\`)
- Para CADA opción de respuesta: Feedback inmediato (por qué es correcta o incorrecta)
- Umbral de aprobación: 80%
- Dificultad variada (EASY, MEDIUM, HARD)
- Tipos permitidos según \`quiz_spec.types\`

---

## 4. Definition of Done (FASE 3)

Considera la Fase 3 terminada solo si:

- Se generaron **todos los componentes previstos** en el plan:

  - Videos necesarios (según Bloom y plan)
  - Diálogo con Lia (SIEMPRE)
  - Lectura (Refuerzo) (SIEMPRE)
  - Cuestionario Formativo (SIEMPRE)

- No se requieren **descargables obligatorios** en ninguna actividad

- La combinación de contenidos respeta la **coherencia Bloom ↔ contenido**

- El Quiz:

  - Tiene 3–5 preguntas (según \`quiz_spec\`)
  - Incluye feedback inmediato por opción
  - Refuerza un **corte de aprobación ≥80%**

- Los guiones y storyboards:
  - Tienen timecodes coherentes
  - Describen visuales específicos
  - **El \`narration_text\` del storyboard es el guion EXACTO, LITERAL y COMPLETO palabra por palabra (cero resúmenes o aproximaciones).**
  - Siguen las estructuras del Prompt Maestro

---

## 5. Formato de salida JSON (OBLIGATORIO)

Responde **SOLO con JSON válido** usando esta estructura exacta:

\`\`\`json
{
  "components": {
    "DIALOGUE": {
      "title": "string",
      "introduction": "string (opcional)",
      "scenes": [
        {
          "character": "Lia | Usuario | Narrador",
          "message": "string",
          "emotion": "neutral | happy | thinking | surprised (opcional)"
        }
      ],
      "conclusion": "string (opcional)",
      "reflection_prompt": "string",
      "improvement_log": {
        "description": "string",
        "fields": ["string"]
      }
    },
    "READING": {
      "title": "string",
      "body_html": "string (HTML formateado, ~750 palabras)",
      "sections": [
        {
          "heading": "string",
          "content": "string"
        }
      ],
      "estimated_reading_time_min": number,
      "key_points": ["string", "string"],
      "reflection_question": "string"
    },
    "QUIZ": {
      "title": "string",
      "instructions": "string",
      "items": [
        {
          "id": "string",
          "question": "string",
          "type": "MULTIPLE_CHOICE | TRUE_FALSE | FILL_BLANK",
          "options": ["A", "B", "C", "D"] (para MULTIPLE_CHOICE),
          "correct_answer": number | string,
          "explanation": "string (REQUERIDO - feedback por opción)",
          "difficulty": "EASY | MEDIUM | HARD",
          "bloom_level": "REMEMBER | UNDERSTAND | APPLY | ANALYZE (opcional)"
        }
      ],
      "passing_score": 80
    },
    "DEMO_GUIDE": {
      "title": "string",
      "objective": "string",
      "prerequisites": ["string"],
      "steps": [
        {
          "step_number": number,
          "instruction": "string",
          "screenshot_placeholder": "string (descripción de imagen)",
          "tip": "string (opcional)",
          "warning": "string (opcional)"
        }
      ],
      "summary": "string",
      "video_script": {
        "title": "string",
        "duration_estimate_minutes": number,
        "sections": [
          {
            "section_number": number,
            "section_type": "introduction | content | conclusion",
            "narration_text": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": number,
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS"
          }
        ]
      },
      "storyboard": [
        {
          "take_number": number,
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "capture | slide | text | diagram",
          "visual_content": "string (descripción exacta)",
          "on_screen_action": "string (opcional)",
          "on_screen_text": "string (opcional)",
          "narration_text": "string (GUIÓN EXACTO Y LITERAL, palabra por palabra, sin resumir)",
          "operational_notes": "string (opcional)"
        }
      ],
      "parallel_exercise": {
        "title": "string",
        "instructions": "string",
        "steps": [
          {
            "step_number": number,
            "instruction": "string",
            "expected_result": "string (opcional)"
          }
        ]
      }
    },
    "EXERCISE": {
      "title": "string",
      "body_html": "string (HTML formateado)",
      "instructions": "string",
      "expected_outcome": "string"
    },
    "VIDEO_THEORETICAL": {
      "title": "string",
      "duration_estimate_minutes": number,
      "script": {
        "sections": [
          {
            "section_number": number,
            "section_type": "introduction | conceptual_development | applications | conclusion",
            "narration_text": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": number,
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS",
            "reflection_question": "string (solo en sección conclusion)"
          }
        ]
      },
      "storyboard": [
        {
          "take_number": number,
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "slide | text | iconography | diagram | b_roll",
          "visual_content": "string (descripción exacta de lo que se ve)",
          "on_screen_text": "string (texto literal en pantalla)",
          "narration_text": "string (GUIÓN EXACTO Y LITERAL, palabra por palabra, sin resumir)",
          "operational_notes": "string (opcional)"
        }
      ]
    },
    "VIDEO_DEMO": {
      "title": "string",
      "duration_estimate_minutes": number,
      "script": {
        "sections": [
          {
            "section_number": number,
            "section_type": "introduction | environment | demonstration | conclusions",
            "narration_text": "string",
            "on_screen_action": "string (acción en pantalla)",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": number,
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS",
            "best_practices": ["string"] (opcional),
            "common_errors": ["string"] (opcional)
          }
        ]
      },
      "storyboard": [
        {
          "take_number": number,
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "capture | screen_recording | zoom | highlight | split_screen | b_roll",
          "visual_content": "string (contenido visual exacto - captura real)",
          "on_screen_action": "string (acción en pantalla)",
          "on_screen_text": "string (texto literal en pantalla)",
          "narration_text": "string (GUIÓN EXACTO Y LITERAL, palabra por palabra, sin resumir)",
          "operational_notes": "string (opcional)"
        }
      ]
    },
    "VIDEO_GUIDE": {
      "title": "string",
      "duration_estimate_minutes": number,
      "script": {
        "sections": [
          {
            "section_number": number,
            "section_type": "introduction | preparation | execution | review | reflection",
            "narration_text": "string",
            "on_screen_text": "string (opcional)",
            "visual_notes": "string",
            "duration_seconds": number,
            "timecode_start": "MM:SS",
            "timecode_end": "MM:SS",
            "success_criteria": "string (opcional)"
          }
        ]
      },
      "storyboard": [
        {
          "take_number": number,
          "timecode_start": "MM:SS",
          "timecode_end": "MM:SS",
          "visual_type": "step_capture | instruction_box | success_criteria | comparison | b_roll",
          "visual_content": "string (contenido visual operativo exacto)",
          "success_criteria_visible": "string (criterio de éxito visible)",
          "on_screen_text": "string (texto literal en pantalla)",
          "narration_text": "string (GUIÓN EXACTO Y LITERAL, palabra por palabra, sin resumir)",
          "operational_notes": "string (opcional)"
        }
      ],
      "parallel_exercise": {
        "title": "string",
        "instructions": "string",
        "steps": [
          {
            "step_number": number,
            "instruction": "string",
            "expected_result": "string (opcional)"
          }
        ]
      }
    }
  },
  "source_refs_used": ["source_id_1", "source_id_2"]
}
\`\`\`

**REGLAS CRÍTICAS DEL JSON:**

1. **components** debe incluir TODOS los componentes solicitados en \`lesson.components\`.
2. **DIALOGUE, READING, QUIZ** son OBLIGATORIOS siempre.
3. **VIDEO_THEORETICAL, VIDEO_DEMO, VIDEO_GUIDE** se generan según el plan:
   - Si el OA es Recordar/Comprender → puede incluir VIDEO_THEORETICAL
   - Si el OA es ≥ Aplicar → debe incluir VIDEO_DEMO o VIDEO_GUIDE
   - Si \`requires_demo_guide: true\` → DEBE incluir DEMO_GUIDE con video_script y storyboard
4. **storyboard** arrays deben tener timecodes coherentes y progresivos. El \`narration_text\` en CADA TOMA debe ser el guion EXACTO a locutar. NO hagas resúmenes. La suma de los \`narration_text\` del storyboard debe ser el script completo al 100%.
5. **visual_content** debe describir EXACTAMENTE lo que se ve en pantalla (sin metáforas abstractas).
6. **explanation** en QUIZ es REQUERIDO para cada pregunta (feedback por opción).
7. **passing_score** en QUIZ debe ser 80.
8. **body_html** en READING debe ser HTML válido (~750 palabras).
9. **source_refs_used** debe listar los IDs de las fuentes realmente utilizadas.
10. NO uses campos adicionales fuera de los especificados.
11. NO incluyas texto fuera del JSON (ni explicaciones, ni Markdown, ni tablas).

**IMPORTANTE FINAL:** Responde SOLO con el JSON, sin texto adicional, sin Markdown, sin explicaciones fuera del JSON. El sistema parseará directamente el JSON y validará la estructura.`;
