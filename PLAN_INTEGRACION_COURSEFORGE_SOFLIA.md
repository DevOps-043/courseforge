# Plan de Integración: CourseForge → Soflia

## Resumen Ejecutivo

Este documento describe el plan de implementación para conectar la plataforma de generación de cursos (CourseForge) con la plataforma principal de aprendizaje (Soflia), permitiendo que los cursos generados puedan ser publicados y consumidos por los usuarios finales.

---

## 1. Contexto

### 1.1 Situación Actual

- **CourseForge**: Plataforma de generación de cursos mediante IA que produce contenido estructurado (módulos, lecciones, quizzes, lecturas, etc.)
- **Soflia**: Plataforma de aprendizaje donde los usuarios consumen los cursos

**Problema**: El contenido generado en CourseForge no tiene forma de llegar a Soflia. Actualmente el proceso es manual o inexistente.

### 1.2 Objetivo

Crear un flujo automatizado que permita:
1. Preparar el contenido generado para publicación (completar campos faltantes)
2. Enviar el contenido a Soflia mediante API
3. Validar/aprobar el contenido en Soflia antes de publicarlo

---

## 2. Arquitectura de la Solución

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            COURSEFORGE                                   │
│                                                                          │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌───────────┐ │
│  │ Paso 1  │ → │ Paso 2  │ → │ Paso 3  │ → │ Paso 4  │ → │  Paso 5   │ │
│  │Syllabus │   │Curation │   │Materials│   │   QA    │   │  Review   │ │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────────┘ │
│                                                                │         │
│                                                                ▼         │
│                                                    ┌───────────────────┐ │
│                                                    │     PASO 6        │ │
│                                                    │   (NUEVO)         │ │
│                                                    │                   │ │
│                                                    │ Preparar para     │ │
│                                                    │ Publicación       │ │
│                                                    │                   │ │
│                                                    │ • Completar datos │ │
│                                                    │ • Preview final   │ │
│                                                    │ • Enviar a Soflia │ │
│                                                    └─────────┬─────────┘ │
└──────────────────────────────────────────────────────────────┼──────────┘
                                                               │
                                                               │ POST /api/courses/import
                                                               │
                                                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              SOFLIA                                      │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    API: /api/courses/import                         ││
│  │                                                                     ││
│  │  • Validar estructura del payload                                   ││
│  │  • Crear curso con approval_status = 'pending'                      ││
│  │  • Crear módulos, lecciones, materiales                             ││
│  │  • Retornar ID del curso creado                                     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                      │                                   │
│                                      ▼                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                 Panel de Aprobación (Admin)                         ││
│  │                                                                     ││
│  │  ┌─────────────────────────────────────────────────────────────┐   ││
│  │  │  Curso: "Introducción a Machine Learning"                   │   ││
│  │  │  Estado: PENDIENTE DE APROBACIÓN                            │   ││
│  │  │                                                             │   ││
│  │  │  [Ver Preview]  [Aprobar ✓]  [Rechazar ✗]                   │   ││
│  │  └─────────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                      │                                   │
│                                      ▼                                   │
│                        approval_status = 'approved'                      │
│                                      │                                   │
│                                      ▼                                   │
│                           CURSO PUBLICADO                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Mapeo de Datos

### 3.1 Tabla Principal: `courses`

| Campo Soflia | Origen en CourseForge | Notas |
|--------------|----------------------|-------|
| `id` | Auto-generado | UUID en Soflia |
| `title` | `artifacts.nombres[0].nombre` | Primer nombre del array |
| `description` | `artifacts.descripcion.larga` | Descripción extendida |
| `category` | **NUEVO CAMPO** | Seleccionar en Paso 6 |
| `level` | **NUEVO CAMPO** | beginner/intermediate/advanced |
| `instructor_id` | **NUEVO CAMPO** | Seleccionar instructor de Soflia |
| `duration_total_minutes` | Calculado | Suma de duraciones de lecciones |
| `thumbnail_url` | **NUEVO CAMPO** | Subir imagen en Paso 6 |
| `slug` | Generado | Basado en título (slugify) |
| `is_active` | `false` | Inactivo hasta aprobación |
| `learning_objectives` | `artifacts.objetivos` | Array de objetivos |
| `approval_status` | `'pending'` | Siempre inicia como pendiente |
| `price` | **NUEVO CAMPO** | 0.00 por defecto (gratuito) |

### 3.2 Tabla: `course_modules`

| Campo Soflia | Origen en CourseForge | Notas |
|--------------|----------------------|-------|
| `module_id` | Auto-generado | UUID |
| `course_id` | FK del curso creado | - |
| `module_title` | `syllabus.modules[i].title` | - |
| `module_description` | `syllabus.modules[i].description` | - |
| `module_order_index` | `syllabus.modules[i].order` | Índice 1-based |
| `module_duration_minutes` | Calculado | Suma de lecciones |
| `is_required` | `true` | Por defecto |
| `is_published` | `false` | Hasta aprobación |

### 3.3 Tabla: `course_lessons`

| Campo Soflia | Origen en CourseForge | Notas |
|--------------|----------------------|-------|
| `lesson_id` | Auto-generado | UUID |
| `module_id` | FK del módulo | - |
| `lesson_title` | `material_lessons.lesson_title` | - |
| `lesson_description` | Extraer de `material_components` | Componente tipo 'intro' |
| `lesson_order_index` | Orden en el módulo | 1-based |
| `video_provider` | **NUEVO CAMPO** | youtube/vimeo/direct |
| `video_provider_id` | **NUEVO CAMPO** | ID del video |
| `duration_seconds` | **NUEVO CAMPO** | Duración del video |
| `transcript_content` | `material_components.content` | Tipo 'transcript' si existe |
| `summary_content` | `material_components.content` | Tipo 'summary' si existe |
| `instructor_id` | Mismo que el curso | - |
| `is_published` | `false` | - |

### 3.4 Tabla: `lesson_materials`

| Campo Soflia | Origen en CourseForge | Notas |
|--------------|----------------------|-------|
| `material_id` | Auto-generado | UUID |
| `lesson_id` | FK de la lección | - |
| `material_title` | Generado según tipo | "Quiz de evaluación", "Lectura complementaria" |
| `material_type` | Mapeo de tipo | Ver tabla de mapeo abajo |
| `content_data` | `material_components.content` | JSONB con el contenido |
| `material_order_index` | Orden del componente | - |
| `estimated_time_minutes` | Calculado o por defecto | - |

**Mapeo de tipos de material:**

| Tipo en CourseForge | Tipo en Soflia |
|--------------------|----------------|
| `quiz` | `quiz` |
| `reading` | `reading` |
| `slides` | `document` |
| `exercise` | `exercise` |
| `demo_guide` | `document` |

### 3.5 Tabla: `lesson_activities` (opcional)

| Campo Soflia | Origen en CourseForge | Notas |
|--------------|----------------------|-------|
| `activity_id` | Auto-generado | - |
| `lesson_id` | FK de la lección | - |
| `activity_title` | Derivado del tipo | - |
| `activity_type` | `reflection`/`exercise`/`quiz`/`discussion`/`ai_chat` | - |
| `activity_content` | Contenido del componente | - |
| `is_required` | Según `is_critical` en CourseForge | - |

---

## 4. Implementación en CourseForge

### 4.1 Nueva Tabla: `publication_requests`

```sql
CREATE TABLE public.publication_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,

  -- Campos adicionales para Soflia
  category text NOT NULL,
  level text NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  instructor_email text NOT NULL,  -- Email del instructor en Soflia
  thumbnail_url text,
  slug text NOT NULL,
  price numeric DEFAULT 0.00,

  -- Información de videos por lección (JSONB)
  lesson_videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Estructura: [{ lesson_id: string, video_provider: string, video_provider_id: string, duration_seconds: number }]

  -- Estado de la solicitud
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'SENT', 'APPROVED', 'REJECTED')),

  -- Respuesta de Soflia
  soflia_course_id uuid,
  soflia_response jsonb,
  sent_at timestamp with time zone,
  response_at timestamp with time zone,
  rejection_reason text,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT publication_requests_pkey PRIMARY KEY (id),
  CONSTRAINT publication_requests_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
```

### 4.2 Nuevo Paso 6: UI de Preparación

**Ruta:** `/admin/artifacts/[id]/publish`

**Componentes necesarios:**

1. **Formulario de datos del curso:**
   - Selector de categoría (dropdown)
   - Selector de nivel (beginner/intermediate/advanced)
   - Input de email del instructor (validar que exista en Soflia)
   - Upload de thumbnail
   - Input de slug (auto-generado, editable)
   - Input de precio (opcional, default 0)

2. **Formulario de videos por lección:**
   - Lista de todas las lecciones del curso
   - Por cada lección:
     - Selector de proveedor (YouTube/Vimeo/Direct)
     - Input del ID del video
     - Input de duración en segundos (o auto-detectar)
     - Botón de preview del video

3. **Preview del curso:**
   - Vista previa de cómo se verá en Soflia
   - Validación de campos requeridos
   - Checklist de completitud

4. **Botón de envío:**
   - "Enviar a Soflia para revisión"
   - Confirmación antes de enviar
   - Indicador de estado del envío

### 4.3 Server Action: Enviar a Soflia

```typescript
// apps/web/src/app/admin/artifacts/[id]/publish/actions.ts

'use server'

interface PublishToSofliaPayload {
  // Datos del curso
  course: {
    title: string
    description: string
    category: string
    level: 'beginner' | 'intermediate' | 'advanced'
    instructor_email: string
    thumbnail_url: string | null
    slug: string
    price: number
    learning_objectives: string[]
  }

  // Módulos con lecciones
  modules: Array<{
    title: string
    description: string
    order_index: number
    lessons: Array<{
      title: string
      description: string
      order_index: number
      video_provider: 'youtube' | 'vimeo' | 'direct'
      video_provider_id: string
      duration_seconds: number
      transcript_content?: string
      summary_content?: string
      materials: Array<{
        title: string
        type: 'quiz' | 'reading' | 'document' | 'exercise'
        content_data: Record<string, unknown>
        order_index: number
        estimated_time_minutes: number
      }>
    }>
  }>

  // Metadata
  source: {
    platform: 'courseforge'
    artifact_id: string
    generated_at: string
  }
}

export async function publishToSoflia(artifactId: string): Promise<{
  success: boolean
  soflia_course_id?: string
  error?: string
}> {
  // 1. Obtener todos los datos del artifact
  // 2. Obtener datos de publication_request
  // 3. Construir payload
  // 4. Enviar a Soflia API
  // 5. Guardar respuesta
  // 6. Retornar resultado
}
```

---

## 5. Implementación en Soflia

### 5.1 Endpoint: POST `/api/courses/import`

**Ubicación sugerida:** `app/api/courses/import/route.ts`

```typescript
// Pseudocódigo del endpoint

export async function POST(request: Request) {
  // 1. Validar API Key de CourseForge
  const apiKey = request.headers.get('X-API-Key')
  if (!isValidCourseForgeKey(apiKey)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parsear y validar payload
  const payload = await request.json()
  const validation = validateImportPayload(payload)
  if (!validation.success) {
    return Response.json({ error: validation.errors }, { status: 400 })
  }

  // 3. Buscar instructor por email
  const instructor = await findUserByEmail(payload.course.instructor_email)
  if (!instructor) {
    return Response.json({ error: 'Instructor not found' }, { status: 404 })
  }

  // 4. Crear curso (transacción)
  const result = await db.transaction(async (tx) => {
    // 4a. Crear curso
    const course = await tx.insert(courses).values({
      title: payload.course.title,
      description: payload.course.description,
      category: payload.course.category,
      level: payload.course.level,
      instructor_id: instructor.id,
      thumbnail_url: payload.course.thumbnail_url,
      slug: payload.course.slug,
      price: payload.course.price,
      learning_objectives: payload.course.learning_objectives,
      approval_status: 'pending',
      is_active: false,
    }).returning()

    // 4b. Crear módulos
    for (const moduleData of payload.modules) {
      const module = await tx.insert(course_modules).values({
        course_id: course[0].id,
        module_title: moduleData.title,
        module_description: moduleData.description,
        module_order_index: moduleData.order_index,
        is_published: false,
      }).returning()

      // 4c. Crear lecciones
      for (const lessonData of moduleData.lessons) {
        const lesson = await tx.insert(course_lessons).values({
          module_id: module[0].module_id,
          lesson_title: lessonData.title,
          lesson_description: lessonData.description,
          lesson_order_index: lessonData.order_index,
          video_provider: lessonData.video_provider,
          video_provider_id: lessonData.video_provider_id,
          duration_seconds: lessonData.duration_seconds,
          transcript_content: lessonData.transcript_content,
          summary_content: lessonData.summary_content,
          instructor_id: instructor.id,
          is_published: false,
        }).returning()

        // 4d. Crear materiales
        for (const materialData of lessonData.materials) {
          await tx.insert(lesson_materials).values({
            lesson_id: lesson[0].lesson_id,
            material_title: materialData.title,
            material_type: materialData.type,
            content_data: materialData.content_data,
            material_order_index: materialData.order_index,
            estimated_time_minutes: materialData.estimated_time_minutes,
          })
        }
      }
    }

    return course[0]
  })

  // 5. Retornar respuesta
  return Response.json({
    success: true,
    course_id: result.id,
    message: 'Course imported successfully. Pending approval.',
  })
}
```

### 5.2 Panel de Aprobación

**Ubicación:** `/admin/courses/pending` (o integrar en panel existente)

**Funcionalidades:**

1. **Lista de cursos pendientes:**
   - Mostrar cursos con `approval_status = 'pending'`
   - Indicar origen (CourseForge)
   - Fecha de recepción

2. **Vista de detalle:**
   - Preview completo del curso
   - Navegación por módulos y lecciones
   - Visualización de quizzes y materiales
   - Preview de videos

3. **Acciones:**
   - **Aprobar:** Cambia `approval_status` a `'approved'` y `is_active` a `true`
   - **Rechazar:** Cambia `approval_status` a `'rejected'`, guarda razón
   - **Editar:** Permitir ajustes menores antes de aprobar

4. **Notificación a CourseForge (webhook opcional):**
   - POST a CourseForge cuando se aprueba/rechaza
   - Actualizar estado en `publication_requests`

### 5.3 Tabla de Control (opcional pero recomendada)

```sql
-- Tabla para rastrear importaciones en Soflia
CREATE TABLE public.course_imports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  source_platform text NOT NULL,  -- 'courseforge'
  source_artifact_id text NOT NULL,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  imported_by_api_key text,
  payload_hash text,  -- Para detectar duplicados

  CONSTRAINT course_imports_pkey PRIMARY KEY (id),
  CONSTRAINT course_imports_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id)
);
```

---

## 6. Flujo de Trabajo Completo

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE PUBLICACIÓN                             │
└─────────────────────────────────────────────────────────────────────────┘

1. GENERACIÓN COMPLETA (CourseForge)
   │
   ├─ Artifact en estado APPROVED (Paso 5 completado)
   │
   ▼
2. PREPARACIÓN PARA PUBLICACIÓN (CourseForge - Paso 6)
   │
   ├─ Usuario completa formulario de datos faltantes
   ├─ Usuario asigna videos a cada lección
   ├─ Sistema valida completitud
   │
   ▼
3. ENVÍO A SOFLIA
   │
   ├─ POST /api/courses/import
   ├─ Soflia crea curso con status='pending'
   ├─ CourseForge guarda soflia_course_id
   │
   ▼
4. REVISIÓN EN SOFLIA
   │
   ├─ Admin de Soflia revisa el curso
   ├─ Puede ver preview, navegar contenido
   │
   ├─── [APROBAR] ──────────────────────┐
   │                                     │
   │    ├─ approval_status = 'approved' │
   │    ├─ is_active = true             │
   │    ├─ Notificar a CourseForge      │
   │    │                               │
   │    ▼                               │
   │    CURSO PUBLICADO Y DISPONIBLE    │
   │                                     │
   └─── [RECHAZAR] ─────────────────────┐
                                        │
        ├─ approval_status = 'rejected' │
        ├─ Guardar razón de rechazo     │
        ├─ Notificar a CourseForge      │
        │                               │
        ▼                               │
        CURSO NO PUBLICADO              │
        (Puede corregirse y reenviarse) │
```

---

## 7. Seguridad

### 7.1 Autenticación de API

- **API Key dedicada** para CourseForge
- Almacenar en variables de entorno de ambas plataformas
- Rotar periódicamente

```env
# En CourseForge (.env)
SOFLIA_API_URL=https://soflia.com/api
SOFLIA_API_KEY=sk_courseforge_xxxxxxxxxxxx

# En Soflia (.env)
COURSEFORGE_API_KEY=sk_courseforge_xxxxxxxxxxxx
```

### 7.2 Validaciones

- Validar estructura del payload con Zod
- Sanitizar contenido HTML/Markdown
- Verificar que el instructor existe
- Verificar que el slug no está duplicado
- Límite de tamaño del payload

### 7.3 Rate Limiting

- Máximo 10 importaciones por hora por API key
- Protección contra duplicados (hash del payload)

---

## 8. Plan de Implementación por Fases

### Fase 1: Infraestructura Base (CourseForge)
- [ ] Crear tabla `publication_requests`
- [ ] Crear página `/admin/artifacts/[id]/publish`
- [ ] Formulario de datos del curso
- [ ] Formulario de videos por lección
- [ ] Validaciones de completitud

### Fase 2: API de Importación (Soflia)
- [ ] Crear endpoint `/api/courses/import`
- [ ] Validación de API Key
- [ ] Validación de payload (Zod schema)
- [ ] Lógica de creación transaccional
- [ ] Tabla `course_imports` (opcional)

### Fase 3: Conexión (CourseForge)
- [ ] Server action para enviar a Soflia
- [ ] Manejo de respuestas y errores
- [ ] Actualización de estado en `publication_requests`
- [ ] UI de estado del envío

### Fase 4: Panel de Aprobación (Soflia)
- [ ] Página de cursos pendientes
- [ ] Vista de preview del curso
- [ ] Acciones de aprobar/rechazar
- [ ] Webhook de notificación (opcional)

### Fase 5: Polish y Testing
- [ ] Tests de integración
- [ ] Manejo de errores edge cases
- [ ] Documentación de API
- [ ] Monitoreo y logs

---

## 9. Consideraciones Adicionales

### 9.1 Manejo de Actualizaciones

Si un curso ya fue enviado y necesita actualizarse:
- Opción A: Crear nuevo curso (versión 2)
- Opción B: Endpoint de actualización (más complejo)

**Recomendación inicial:** Opción A para MVP

### 9.2 Rollback

Si algo falla durante la importación:
- La transacción debe hacer rollback completo
- No dejar datos huérfanos
- Retornar error descriptivo

### 9.3 Contenido Multimedia

Para thumbnails y otros assets:
- CourseForge sube a su storage
- Pasa URLs públicas a Soflia
- Soflia puede copiar a su storage (opcional)

### 9.4 Quizzes: Estructura de `content_data`

```json
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "question": "¿Qué es Machine Learning?",
      "options": [
        { "id": "a", "text": "Un tipo de base de datos" },
        { "id": "b", "text": "Un campo de la IA que permite a las máquinas aprender" },
        { "id": "c", "text": "Un lenguaje de programación" },
        { "id": "d", "text": "Un sistema operativo" }
      ],
      "correct_answer": "b",
      "explanation": "Machine Learning es un subcampo de la IA..."
    }
  ],
  "passing_score": 70,
  "time_limit_minutes": null,
  "shuffle_questions": true,
  "shuffle_options": true
}
```

---

## 10. Contacto y Recursos

- **Repositorio CourseForge:** [URL del repo]
- **Repositorio Soflia:** [URL del repo]
- **Documentación BD CourseForge:** `BD.sql`
- **Documentación BD Soflia:** `BDSoflia.sql`

---

*Documento generado el: 2026-01-28*
*Versión: 1.0*
