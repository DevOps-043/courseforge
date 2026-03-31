# Sistema de Prompts Modulares — Documentación Técnica y Empresarial

**Proyecto:** Courseforge
**Versión del sistema:** Modular v2 (desde migración `20260327`)
**Última actualización:** 2026-03-30
**Fuente de verdad de calidad:** `prompt_maestro.md`

---

## Tabla de Contenidos

1. [Visión General](#1-visión-general)
2. [Arquitectura del Sistema de Prompts](#2-arquitectura-del-sistema-de-prompts)
3. [Catálogo de Prompts](#3-catálogo-de-prompts)
   - [INSTRUCTIONAL_PLAN](#31-instructional_plan)
   - [CURATION_PLAN](#32-curation_plan)
   - [MATERIALS_SYSTEM](#33-materials_system)
   - [MATERIALS_DIALOGUE](#34-materials_dialogue)
   - [MATERIALS_READING](#35-materials_reading)
   - [MATERIALS_QUIZ](#36-materials_quiz)
   - [MATERIALS_VIDEO_THEORETICAL](#37-materials_video_theoretical)
   - [MATERIALS_VIDEO_DEMO](#38-materials_video_demo)
   - [MATERIALS_VIDEO_GUIDE](#39-materials_video_guide)
   - [MATERIALS_DEMO_GUIDE](#310-materials_demo_guide)
   - [MATERIALS_EXERCISE](#311-materials_exercise)
   - [MATERIALS_GENERATION (Legacy)](#312-materials_generation-legacy)
4. [Pipeline de Activación por Fase](#4-pipeline-de-activación-por-fase)
5. [Lógica de Resolución de Prompts](#5-lógica-de-resolución-de-prompts)
6. [Modelo de Datos](#6-modelo-de-datos)
7. [Personalización por Organización](#7-personalización-por-organización)
8. [Gestión desde el Admin](#8-gestión-desde-el-admin)
9. [Restricciones Globales](#9-restricciones-globales)
10. [Guía para Editar Prompts](#10-guía-para-editar-prompts)

---

## 1. Visión General

El sistema de prompts de Courseforge gestiona las instrucciones que recibe el modelo de IA (Google Gemini) para generar cada parte de un curso. A partir de la migración `20260327`, el sistema pasó de un único prompt monolítico (`MATERIALS_GENERATION`) a una arquitectura modular de 11 prompts independientes.

### ¿Por qué modularizar?

| Problema (monolítico) | Solución (modular) |
|---|---|
| Un cambio afectaba todos los tipos de componente | Cada tipo se puede ajustar sin riesgo de regresión |
| El prompt era demasiado largo y costoso en tokens | Solo se carga lo necesario para los componentes de cada lección |
| No era posible regenerar un solo componente | Se puede regenerar un `READING` sin tocar el `QUIZ` de la misma lección |
| Personalización imposible por organización | Cada organización puede sobreescribir solo los prompts que necesite |

### Responsabilidad de cada capa

```
┌─────────────────────────────────────────────────────────────────┐
│  FASE 1 - Planificación: INSTRUCTIONAL_PLAN                     │
│  Define QUÉ componentes tendrá cada lección y con qué objetivo  │
├─────────────────────────────────────────────────────────────────┤
│  FASE 2 - Curación: CURATION_PLAN                               │
│  Define CON QUÉ fuentes se va a generar cada componente         │
├─────────────────────────────────────────────────────────────────┤
│  FASE 3 - Generación: MATERIALS_SYSTEM + prompts por componente │
│  Define CÓMO generar el contenido de cada componente            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Arquitectura del Sistema de Prompts

### Archivos clave

| Archivo | Rol |
|---|---|
| `apps/web/src/shared/config/prompts/materials-generation.prompts.modular.ts` | Definiciones hardcoded de todos los prompts modulares (fallback final) |
| `apps/web/src/shared/config/prompts/prompt-resolver.service.ts` | Lógica de resolución y ensamblado del prompt final |
| `apps/web/src/domains/prompts/components/SystemPromptsManager.tsx` | UI de administración de prompts |
| `apps/web/src/domains/prompts/types.ts` | Tipos TypeScript del sistema |
| `supabase/migrations/20260327120000_modular_material_prompts.sql` | Seed inicial de los 11 prompts modulares |
| `supabase/migrations/20240117_create_system_prompts.sql` | Creación de la tabla `system_prompts` |

### Flujo de ensamblado del prompt

```
generateMaterialsWithGemini(lesson, componentTypes)
         │
         ▼
resolvePrompts(supabase, componentTypes, organizationId)
         │
         ├── Para cada tipo (e.g., DIALOGUE):
         │     1. Busca en DB: organización actual + is_active = true
         │     2. Si no: busca en DB: org_id IS NULL + is_active = true
         │     3. Si no: usa hardcoded en modular.ts
         │
         ▼
assemblePrompt(resolvedPrompts, componentTypes)
         │
         ├── Agrega MATERIALS_SYSTEM (reglas globales)
         ├── Agrega instrucciones de cada componente
         └── Agrega schemas JSON de output esperado
         │
         ▼
Gemini API (structured generation)
```

---

## 3. Catálogo de Prompts

---

### 3.1 `INSTRUCTIONAL_PLAN`

**Fase del pipeline:** 1 — Planificación instruccional
**Background job:** `instructional-plan-background.ts`
**Tabla de salida:** `instructional_plans`

#### ¿Qué hace?

Toma el syllabus del curso (módulos y lecciones) y genera un **plan de aprendizaje detallado** por lección. Para cada lección define el objetivo de aprendizaje, su nivel taxonómico según Bloom, y la lista de componentes educativos que la forman.

#### Área que cubre

- Diseño instruccional y pedagógico
- Taxonomía de Bloom (Remember, Understand, Apply, Analyze, Evaluate, Create)
- Estructura curricular por lección
- Tipificación de componentes (qué tipo de contenido se necesita)
- Detección del tipo de curso: `TEORICO` vs `PROCEDIMENTAL`

#### Entrada

```
- Título del curso
- Descripción
- Objetivos generales del artefacto
- Estructura del syllabus (módulos + lecciones)
```

#### Salida (JSON)

```json
[
  {
    "lesson_id": "les-1-1",
    "lesson_title": "Introducción a Python",
    "lesson_order": 1,
    "module_id": "mod-1",
    "module_title": "Fundamentos",
    "oa_text": "El estudiante será capaz de...",
    "oa_bloom_verb": "comprender",
    "measurable_criteria": "...",
    "course_type_detected": "TEORICO",
    "components": [
      { "type": "DIALOGUE", "summary": "..." },
      { "type": "READING", "summary": "..." },
      { "type": "QUIZ", "summary": "..." }
    ]
  }
]
```

#### Impacto colateral

Este prompt determina **qué prompts de materiales se ejecutarán** en la Fase 3. Si el plan incluye `VIDEO_DEMO`, se activará `MATERIALS_VIDEO_DEMO`. Si no incluye `EXERCISE`, ese prompt nunca se invoca.

---

### 3.2 `CURATION_PLAN`

**Fase del pipeline:** 2 — Curación de fuentes
**Background job:** `unified-curation-logic.ts`
**Tabla de salida:** `curation_rows`

#### ¿Qué hace?

Para cada lección y sus componentes, busca y valida **fuentes externas confiables** que serán usadas como base de conocimiento en la generación de materiales. Documenta todo en una bitácora de uso de IA.

#### Área que cubre

- Búsqueda y validación de fuentes educativas (Google Search grounding)
- Criterios de aceptación: status HTTP, sin paywall, contenido ≥500 caracteres, sin descarga obligatoria
- Cobertura por tipo de componente (DIALOGUE, READING, QUIZ, VIDEO, DEMO_GUIDE, EXERCISE)
- Auditoría de uso de IA (`bitacora[]`)
- Licenciamiento y accesibilidad de URLs

#### Entrada

```
- Planes de lección (lesson_plans[])
- Objetivos de aprendizaje por lección
- Tipos de componentes esperados
```

#### Salida (JSON)

```json
{
  "sources_by_lesson": [
    {
      "lesson_id": "les-1-1",
      "candidate_sources": [
        {
          "component_type": "READING",
          "url": "https://docs.python.org/...",
          "title": "Python Documentation",
          "justification": "...",
          "requires_download": false,
          "is_acceptable": true,
          "http_status": 200
        }
      ]
    }
  ],
  "bitacora": [...]
}
```

#### QA Manual requerido

Después de la curación automática, un administrador debe revisar cada fuente y marcarla como **"Aprobado"** o **"No Apto"** antes de avanzar a la generación de materiales.

---

### 3.3 `MATERIALS_SYSTEM`

**Fase del pipeline:** 3 — Generación de materiales
**Rol:** Prompt base del sistema (se incluye en TODAS las generaciones)
**Tabla de salida:** N/A (es parte del prompt ensamblado)

#### ¿Qué hace?

Define las **reglas globales e invariantes** que aplican a cualquier generación de material, independientemente del tipo de componente. Es el equivalente a las "instrucciones del sistema" que preceden a cualquier instrucción específica.

#### Área que cubre

- Formato de respuesta: JSON estricto, sin texto fuera del objeto
- Accesibilidad: español neutro, tono profesional
- Restricción crítica: **ningún material puede requerir descargas o archivos del estudiante**
- Coherencia pedagógica: el contenido debe alinearse con el objetivo de aprendizaje y nivel Bloom
- Calidad del contenido: profundidad real, no superficial

#### Reglas críticas que impone

```
1. Responde SOLO con JSON válido
2. No incluyas texto, markdown ni comentarios fuera del objeto JSON
3. Ningún componente debe requerir que el estudiante descargue o suba archivos
4. El contenido debe ser coherente con el OA y el nivel Bloom de la lección
5. Usa español neutro, profesional y accesible
```

#### Relación con otros prompts

`MATERIALS_SYSTEM` se inyecta **siempre primero** en el prompt ensamblado. Los prompts de componentes específicos se agregan después como instrucciones adicionales.

---

### 3.4 `MATERIALS_DIALOGUE`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `DIALOGUE`
**Activación:** Siempre (componente obligatorio en toda lección)

#### ¿Qué hace?

Genera una **actividad conversacional interactiva** entre el estudiante y la asistente IA Lia. Simula un diálogo de tutoría donde Lia guía al estudiante a través del tema con preguntas socráticas, ejemplos y reflexiones.

#### Área que cubre

- Pedagogía conversacional y tutoría guiada
- Comprensión activa del tema (no pasiva)
- Activación de conocimiento previo
- Preguntas de reflexión y metacognición
- Duración estimada: 5-9 minutos

#### Entrada (en el prompt ensamblado)

```
- Título de la lección
- Objetivo de aprendizaje (oa_text)
- Nivel Bloom (oa_bloom_verb)
- Resumen del componente (summary del plan instruccional)
- Fuentes curadas aptas (source_refs)
```

#### Salida (JSON)

```json
{
  "title": "...",
  "scenes": [
    {
      "scene_number": 1,
      "lia_message": "...",
      "student_options": ["...", "..."],
      "lia_response_per_option": { "0": "...", "1": "..." },
      "emotion": "curious"
    }
  ],
  "conclusion": "...",
  "reflection_prompt": "...",
  "improvement_log": []
}
```

---

### 3.5 `MATERIALS_READING`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `READING`
**Activación:** Siempre (componente obligatorio en toda lección)

#### ¿Qué hace?

Genera un **artículo de lectura estructurado** de ~750 palabras que refuerza el tema de la lección. El contenido es original, basado en las fuentes curadas, y formateado en HTML para renderizado directo.

#### Área que cubre

- Síntesis de conocimiento teórico
- Redacción educativa clara y estructurada
- Identificación de conceptos clave
- Fomento a la reflexión post-lectura

#### Estructura del artículo

```
- Introducción al tema
- Sección 1: Concepto principal
- Sección 2: Aplicación o profundización
- Sección 3: Ejemplos o casos
- Puntos clave del artículo (bullets)
- Pregunta de reflexión al finalizar
```

#### Salida (JSON)

```json
{
  "title": "...",
  "body_html": "<p>...</p><h2>...</h2>...",
  "sections": [
    { "heading": "...", "content": "..." }
  ],
  "key_points": ["...", "...", "...", "..."],
  "reflection_question": "...",
  "estimated_reading_time_minutes": 4
}
```

---

### 3.6 `MATERIALS_QUIZ`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `QUIZ`
**Activación:** Siempre (componente obligatorio en toda lección)

#### ¿Qué hace?

Genera una **evaluación sumativa** alineada con el objetivo de aprendizaje y nivel Bloom de la lección. Incluye entre 3 y 5 preguntas con retroalimentación para cada opción.

#### Área que cubre

- Evaluación del aprendizaje
- Cobertura de los conceptos centrales de la lección
- Retroalimentación formativa por opción (no solo la correcta)
- Tipos de pregunta: opción múltiple, verdadero/falso, completar frase
- Nota mínima de aprobación: 80%

#### Reglas del quiz

```
- 3-5 preguntas
- Cada pregunta tiene exactamente 4 opciones (a, b, c, d) salvo V/F
- Todas las opciones tienen explicación (correcta e incorrectas)
- El nivel de dificultad se alinea con el nivel Bloom del OA
- No se repiten preguntas triviales o demasiado similares
```

#### Salida (JSON)

```json
{
  "title": "...",
  "passing_score": 80,
  "items": [
    {
      "question": "...",
      "type": "multiple_choice",
      "options": [
        { "label": "a", "text": "...", "is_correct": false, "explanation": "..." },
        { "label": "b", "text": "...", "is_correct": true, "explanation": "..." }
      ],
      "bloom_level": "comprender"
    }
  ]
}
```

---

### 3.7 `MATERIALS_VIDEO_THEORETICAL`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `VIDEO_THEORETICAL`
**Activación:** Condicional — lecciones de nivel Bloom: Remember / Understand (cursos teóricos)

#### ¿Qué hace?

Genera el **guión completo y storyboard** de un video explicativo teórico. El video está orientado a presentar conceptos, marcos conceptuales, teorías o fundamentos de forma clara y visual.

#### Área que cubre

- Guionización de video educativo teórico
- Estructura narrativa del contenido (introducción → desarrollo → cierre)
- Storyboard con descripciones visuales y texto en pantalla
- Narración literal (no resumen: texto exacto que dirá el presentador)
- Duración estimada: 6-12 minutos

#### Salida (JSON)

```json
{
  "duration_estimate": "8 min",
  "script": {
    "sections": [
      {
        "section_title": "Introducción",
        "narration_text": "En este video vamos a explorar...",
        "on_screen_text": "¿Qué es el Machine Learning?"
      }
    ]
  },
  "storyboard": [
    {
      "take": 1,
      "timecode": "0:00-0:45",
      "narration_text": "Texto exacto de narración...",
      "visual_description": "Presentador en pantalla con fondo azul...",
      "on_screen_text": "Machine Learning: Definición",
      "b_roll_prompt": "Animación mostrando flujo de datos..."
    }
  ]
}
```

#### Regla crítica

El campo `narration_text` en el storyboard debe ser **literal y completo** — es el texto que el presentador leerá en cámara. No puede ser un resumen.

---

### 3.8 `MATERIALS_VIDEO_DEMO`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `VIDEO_DEMO`
**Activación:** Condicional — lecciones de nivel Bloom: Apply / Analyze (cursos procedimentales)

#### ¿Qué hace?

Genera el **guión y storyboard de un video demostración** donde se muestra cómo usar una herramienta, plataforma o proceso real. Por ejemplo: cómo usar ChatGPT, cómo crear una tabla dinámica en Excel, cómo configurar un pipeline en GitHub Actions.

#### Área que cubre

- Demostración práctica de herramientas y procesos
- Estructura paso a paso con narración sincronizada
- Buenas prácticas y errores comunes documentados en el storyboard
- Captura de pantalla / screencast implícito en el diseño

#### Diferencia vs VIDEO_THEORETICAL

| `VIDEO_THEORETICAL` | `VIDEO_DEMO` |
|---|---|
| Explica conceptos, teorías | Muestra cómo hacer algo |
| El presentador habla a cámara | El presentador comparte pantalla |
| Sin interacción con software | Con interacción directa con herramienta |
| Bloom: Remember/Understand | Bloom: Apply/Analyze |

#### Salida (JSON)

```json
{
  "duration_estimate": "10 min",
  "script": {
    "sections": [...]
  },
  "storyboard": [
    {
      "take": 1,
      "timecode": "0:00-1:00",
      "narration_text": "...",
      "screen_action": "Abrir navegador, ir a chat.openai.com",
      "best_practices": ["...", "..."],
      "common_errors": ["...", "..."]
    }
  ]
}
```

---

### 3.9 `MATERIALS_VIDEO_GUIDE`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `VIDEO_GUIDE`
**Activación:** Condicional — lecciones de nivel Bloom: Apply+ con práctica guiada

#### ¿Qué hace?

Genera el **guión, storyboard y ejercicio paralelo** de un video donde el estudiante sigue los pasos simultáneamente con el presentador. No solo observa: ejecuta las mismas acciones en su entorno mientras ve el video.

#### Área que cubre

- Aprendizaje activo guiado paso a paso
- Práctica simultánea (estudiante hace mientras ve)
- Instrucciones claras para que el estudiante configure su entorno
- Ejercicio paralelo estructurado (pasos propios para el estudiante)

#### Diferencia vs VIDEO_DEMO

| `VIDEO_DEMO` | `VIDEO_GUIDE` |
|---|---|
| El estudiante observa al presentador | El estudiante hace lo mismo en paralelo |
| Demostrativo | Práctico-guiado |
| No requiere que el estudiante tenga herramienta abierta | Requiere que el estudiante tenga su entorno listo |

#### Salida (JSON)

```json
{
  "duration_estimate": "12 min",
  "script": { "sections": [...] },
  "storyboard": [...],
  "parallel_exercise": {
    "title": "Practica mientras ves",
    "setup_instructions": "Abre tu entorno de...",
    "steps": [
      { "step": 1, "instruction": "...", "expected_result": "..." }
    ]
  }
}
```

---

### 3.10 `MATERIALS_DEMO_GUIDE`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `DEMO_GUIDE`
**Activación:** Condicional — cuando el plan instruccional marca `requires_demo_guide: true`

#### ¿Qué hace?

Genera una **guía detallada de demostración** con pasos numerados, instrucciones, screenshots esperados, tips y advertencias. Incluye también el guión del video que acompaña a la guía.

#### Área que cubre

- Documentación técnica step-by-step (similar a tutoriales de producto)
- Pasos visuales con descripción de screenshots esperados
- Tips y advertencias contextuales
- Guión del video de demostración asociado
- Ejercicio paralelo para práctica independiente

#### Diferencia vs VIDEO_DEMO

`DEMO_GUIDE` es una guía **escrita** (con pasos documentados), mientras que `VIDEO_DEMO` es el **guión del video**. Pueden coexistir en la misma lección.

#### Salida (JSON)

```json
{
  "title": "...",
  "steps": [
    {
      "step_number": 1,
      "instruction": "...",
      "screenshot_description": "...",
      "tip": "...",
      "warning": null
    }
  ],
  "summary": "...",
  "video_script": "...",
  "storyboard": [...],
  "parallel_exercise": { "steps": [...] }
}
```

---

### 3.11 `MATERIALS_EXERCISE`

**Fase del pipeline:** 3 — Generación de materiales
**Componente:** `EXERCISE`
**Activación:** Condicional — lecciones de nivel Bloom: Apply, Analyze, Evaluate, Create

#### ¿Qué hace?

Genera una **actividad práctica independiente** que el estudiante realiza por su cuenta. Es la aplicación autónoma del aprendizaje, sin guía del presentador.

#### Área que cubre

- Aplicación independiente de conocimientos
- Producción de un entregable concreto (documento, análisis, diseño, código, etc.)
- Instrucciones claras y resultado esperado definido
- Nivel de dificultad calibrado al nivel Bloom del OA

#### Restricción crítica

**El ejercicio NO puede requerir que el estudiante descargue archivos externos ni suba archivos a plataformas de terceros.** El entregable debe poder completarse dentro del entorno del curso o en texto libre.

#### Salida (JSON)

```json
{
  "title": "...",
  "body_html": "<p>Descripción del ejercicio...</p>",
  "instructions": [
    "Paso 1: ...",
    "Paso 2: ..."
  ],
  "expected_outcome": "...",
  "difficulty": "intermediate",
  "estimated_time_minutes": 20
}
```

---

### 3.12 `MATERIALS_GENERATION` (Legacy)

**Estado:** Deprecado — fallback de compatibilidad
**Archivo:** `apps/web/src/shared/config/prompts/materials-generation.prompts.legacy.ts`

#### ¿Qué hace?

Era el prompt monolítico original que generaba todos los tipos de componentes en una sola invocación. Fue reemplazado por el sistema modular en `20260327`.

#### Cuándo se usa actualmente

Solo se invoca si el sistema modular falla completamente y no hay ningún prompt disponible (ni en DB ni en los fallbacks hardcoded). En la práctica, **no debería activarse** en condiciones normales.

#### Por qué no eliminarlo aún

Sirve como red de seguridad en caso de errores de migración o corrupción de los prompts en base de datos. Se puede deprecar definitivamente una vez que el sistema modular lleve 30+ días en producción estable.

---

## 4. Pipeline de Activación por Fase

```
Artefacto creado
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ FASE 1: generate-artifact-background.ts                         │
│ Prompts: (ninguno del catálogo — usa Gemini con grounding)      │
│ Salida: objetivos[], nombres[]                                  │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (aprobación manual)
┌─────────────────────────────────────────────────────────────────┐
│ FASE 1B: syllabus-generation-background.ts                      │
│ Prompts: (ninguno del catálogo — genera estructura JSON)        │
│ Salida: modules[], route (A_WITH_SOURCE | B_NO_SOURCE)         │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (aprobación manual)
┌─────────────────────────────────────────────────────────────────┐
│ FASE 2: instructional-plan-background.ts                        │
│ Prompt: INSTRUCTIONAL_PLAN                                      │
│ Salida: lesson_plans[] con componentes por lección              │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ FASE 3: unified-curation-logic.ts                               │
│ Prompt: CURATION_PLAN                                           │
│ Salida: curation_rows con URLs validadas                        │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼ (QA manual de fuentes)
┌─────────────────────────────────────────────────────────────────┐
│ FASE 4: materials-generation-background.ts                      │
│ Prompts: MATERIALS_SYSTEM + 1-8 prompts de componente           │
│          (según los componentes del plan instruccional)         │
│ Salida: material_components[] con contenido por tipo            │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ FASE 5: video-prompts-generation.ts                             │
│ Prompts: (ninguno del catálogo — usa storyboards generados)     │
│ Salida: b_roll_prompts, production_assets                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Lógica de Resolución de Prompts

Archivo: `prompt-resolver.service.ts`

### Cadena de resolución (por prompt code)

```
1. DB: organization_id = actual + is_active = true → Usa prompt custom de la org
2. DB: organization_id IS NULL + is_active = true   → Usa prompt global
3. Hardcoded en modular.ts                          → Fallback final
```

### Ensamblado del prompt final

```typescript
assemblePrompt(resolvedPrompts, componentTypes)
  → MATERIALS_SYSTEM (siempre primero)
  → MATERIALS_DIALOGUE (si 'DIALOGUE' en componentTypes)
  → MATERIALS_READING  (si 'READING' en componentTypes)
  → MATERIALS_QUIZ     (si 'QUIZ' en componentTypes)
  → [otros componentes según plan]
  → OUTPUT_SCHEMAS (fragmentos JSON para cada tipo incluido)
```

### Mapeo componente → código de prompt

| Tipo de Componente | Código de Prompt |
|---|---|
| `DIALOGUE` | `MATERIALS_DIALOGUE` |
| `READING` | `MATERIALS_READING` |
| `QUIZ` | `MATERIALS_QUIZ` |
| `VIDEO_THEORETICAL` | `MATERIALS_VIDEO_THEORETICAL` |
| `VIDEO_DEMO` | `MATERIALS_VIDEO_DEMO` |
| `VIDEO_GUIDE` | `MATERIALS_VIDEO_GUIDE` |
| `DEMO_GUIDE` | `MATERIALS_DEMO_GUIDE` |
| `EXERCISE` | `MATERIALS_EXERCISE` |

---

## 6. Modelo de Datos

### Tabla `system_prompts`

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | UUID | PK |
| `code` | text | Identificador único del prompt (e.g., `MATERIALS_DIALOGUE`) |
| `version` | text | Versión semántica (e.g., `1.0.0`) |
| `content` | text | Contenido completo del prompt |
| `description` | text | Descripción legible para humanos |
| `is_active` | boolean | Si el prompt está activo (solo el activo se usa) |
| `organization_id` | UUID (nullable) | Si es NULL: prompt global. Si tiene valor: prompt de organización específica |
| `created_at` | timestamptz | Creación |
| `updated_at` | timestamptz | Última modificación |

**Constraint único:** `(code, version, organization_id)` — permite distintas versiones y variantes por org.

### Políticas RLS

- Lectura: usuario puede ver prompts de su organización **o** prompts globales (`org_id IS NULL`)
- Escritura: usuario solo puede crear/modificar prompts de **su propia organización**
- Los prompts globales solo pueden modificarse con `service_role` (desde migraciones)

---

## 7. Personalización por Organización

Cada organización puede sobreescribir cualquier prompt sin afectar a otras organizaciones ni al global.

### Casos de uso típicos

| Caso | Prompt a sobreescribir |
|---|---|
| Cambiar el tono del diálogo con Lia | `MATERIALS_DIALOGUE` |
| Ajustar la cantidad de preguntas del quiz | `MATERIALS_QUIZ` |
| Requerir un formato específico para el HTML de Reading | `MATERIALS_READING` |
| Adaptar las reglas globales al idioma corporativo | `MATERIALS_SYSTEM` |
| Ajustar criterios de búsqueda de fuentes | `CURATION_PLAN` |

### Ciclo de vida de un prompt de organización

```
1. Admin edita el prompt desde /admin/settings → Prompts
2. Se guarda en system_prompts con organization_id = org actual
3. El resolver prioriza esta versión sobre el global
4. Admin puede hacer "Reset to default" → se elimina la versión de org
5. El resolver vuelve a usar el global
```

---

## 8. Gestión desde el Admin

**Ruta:** `/admin/settings` → sección Prompts

### Funciones disponibles

| Acción | Descripción | Efecto en DB |
|---|---|---|
| **Ver prompt** | Lee el contenido actual del prompt (org o global) | Solo lectura |
| **Editar y guardar** | Modifica el contenido del prompt | INSERT/UPDATE en `system_prompts` con org_id |
| **Reset to default** | Elimina el override de la organización | DELETE del registro con org_id |
| **Identificar override** | Dot amarillo (●) indica prompt personalizado por la org | — |

### Indicadores visuales

- **● Punto amarillo** junto al nombre: el prompt tiene un override de la organización activa
- **Sin punto**: el prompt usa el valor global (compartido por todas las organizaciones sin override)

---

## 9. Restricciones Globales

Estas restricciones aplican a **todos los prompts** y son impuestas por `MATERIALS_SYSTEM`:

| Restricción | Razón |
|---|---|
| Sin descargas obligatorias | Accesibilidad: el estudiante no debe necesitar instalar nada |
| JSON válido únicamente | El sistema hace parsing automático; texto libre rompe el pipeline |
| Español neutro | Audiencia latinoamericana diversa |
| Alineación con Bloom | El nivel de dificultad debe corresponder al OA del plan instruccional |
| Narración literal en storyboards | El script se usa directamente para producción de video; resúmenes no sirven |
| Quiz: 80% nota mínima | Estándar pedagógico de la plataforma |
| Reading: ~750 palabras | Tiempo de lectura óptimo para formato digital (~4 min) |

---

## 10. Guía para Editar Prompts

### Antes de editar

1. Leer el prompt completo para entender su estructura actual
2. Identificar si el cambio es organizacional (solo afecta mi org) o global (afecta a todos)
3. Revisar el schema de output esperado — si lo cambias, el pipeline puede romperse

### Qué se puede cambiar con bajo riesgo

- Tono de redacción (formal/conversacional)
- Longitud de contenido (~N palabras)
- Cantidad de ítems (e.g., "genera 5 preguntas en lugar de 3")
- Instrucciones adicionales de estilo o formato

### Qué NO se debe cambiar sin validar el pipeline

- La estructura del objeto JSON de salida (campos, nombres, tipos)
- La instrucción de "responde solo con JSON"
- El `passing_score` del quiz si hay lógica hardcodeada que lo valida
- El campo `narration_text` si hay un proceso de producción de video activo

### Proceso de prueba al editar un prompt

```
1. Editar prompt en /admin/settings
2. Crear un artefacto de prueba (o regenerar un componente existente)
3. Verificar que el JSON generado sea válido y tenga todos los campos esperados
4. Revisar el material generado desde /admin/library
5. Si algo falló, hacer "Reset to default" y revisar el error en los logs
```

---

*Documentación generada en base al código fuente del proyecto y a los criterios de calidad definidos en `prompt_maestro.md`.*
