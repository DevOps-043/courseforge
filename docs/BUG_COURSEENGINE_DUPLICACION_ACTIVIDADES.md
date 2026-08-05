# Bug Report: Duplicación de Actividades y Materiales por Re-importación desde CourseEngine

**Fecha de detección:** 2026-04-20  
**Severidad:** Alta  
**Afecta:** SofLIA Learning (plataforma) y CourseEngine (generador)  
**Estado en SofLIA:** Corregido  
**Estado en CourseEngine:** Revisión pendiente (ver sección de recomendaciones)

---

## Resumen Ejecutivo

Cada vez que CourseEngine re-publicaba un curso (mismo `slug`), las actividades y materiales de todas las lecciones se **multiplicaban** en la base de datos. Un curso publicado 5 veces tenía 5 copias de cada actividad. El usuario veía "5 quizzes obligatorios" cuando en realidad debería haber 1. El fix fue aplicado en SofLIA Learning. Se describe a continuación qué debe revisarse en CourseEngine para garantizar interoperabilidad segura.

---

## 1. Descripción del Problema

### Síntomas observados

- La pestaña **Actividades** de una lección mostraba contenido duplicado (ej. 5 actividades iguales en lugar de 1).
- Al intentar completar una actividad aparecía el modal: `"Hace falta realizar actividad — Debes completar y aprobar todos los quizzes obligatorios (1/5 completados)"`.
- Los **Materiales** también aparecían multiplicados desde la primera lección.
- El error `"Error al registrar la actividad completada"` ocurría porque el sistema encontraba múltiples registros donde esperaba uno.
- El número de quizzes requeridos (`quizStatus.totalRequiredQuizzes`) era incorrecto porque contaba duplicados.

### Causa raíz

El endpoint de importación en SofLIA Learning (`POST /api/courses/import`) tenía lógica **no idempotente** para módulos, lecciones, actividades y materiales:

```
COURSES     → upsert por slug  ✅ idempotente
MODULES     → INSERT siempre   ❌ NO idempotente
LESSONS     → INSERT siempre   ❌ NO idempotente
ACTIVITIES  → INSERT siempre   ❌ NO idempotente
MATERIALS   → INSERT siempre   ❌ NO idempotente
```

**Flujo del bug:**

```
CourseEngine publica Curso "X" (slug: "curso-x") →
  SofLIA: upsert curso OK, INSERT módulos/lecciones/actividades (1 copia)

CourseEngine actualiza y re-publica "X" (slug: "curso-x") →
  SofLIA: upsert curso OK (mismo ID), INSERT módulos/lecciones/actividades (2 copias)

[...después de 5 re-publicaciones...]
  Base de datos: 5 copias de cada módulo, lección, actividad y material
```

La tabla `courses` queda correcta (1 fila por slug), pero las tablas hijas acumulan filas duplicadas en cada re-importación.

---

## 2. Archivos Afectados en SofLIA Learning

| Archivo | Rol |
|---|---|
| `apps/web/src/app/api/courses/import/route.ts` | Endpoint que recibe el payload de CourseEngine. Aquí estaba el bug y se aplicó el fix. |
| `apps/web/src/app/api/courses/[slug]/lessons/[lessonId]/activities/route.ts` | Lee `lesson_activities` por `lesson_id`. Con duplicados en DB retornaba múltiples registros. |
| `apps/web/src/app/api/courses/[slug]/lessons/[lessonId]/sidebar-data/route.ts` | Lee actividades y materiales para el sidebar. Afectado por los duplicados. |
| `apps/web/src/app/api/courses/[slug]/lessons/[lessonId]/quiz/status/route.ts` | Calculaba `totalRequiredQuizzes` sumando todos los quizzes de la lección, incluyendo duplicados. |

---

## 3. Fix Aplicado en SofLIA Learning

**Archivo:** `apps/web/src/app/api/courses/import/route.ts`

**Lógica del fix:**

Antes de insertar los nuevos módulos, el endpoint ahora verifica si el curso ya tiene módulos registrados en la base de datos. Si los tiene (señal de que es una re-importación), los elimina completamente antes de proceder con la inserción. Las foreign keys configuradas con `CASCADE DELETE` en Supabase limpian automáticamente la cadena:

```
course_modules → course_lessons → lesson_activities
                                → lesson_materials
```

**Código añadido (sección B, después del upsert del curso):**

```typescript
// Si el curso ya existía, eliminar módulos previos para evitar duplicación.
// Las FK con CASCADE limpian course_lessons, lesson_activities y lesson_materials.
const { count: existingModulesCount } = await supabase
    .from('course_modules')
    .select('*', { count: 'exact', head: true })
    .eq('course_id', newCourse.id)

if (existingModulesCount && existingModulesCount > 0) {
    console.info(`[IMPORT API] Re-import detected for course "${newCourse.id}". Clearing ${existingModulesCount} existing module(s).`)
    const { error: deleteError } = await supabase
        .from('course_modules')
        .delete()
        .eq('course_id', newCourse.id)

    if (deleteError) {
        return NextResponse.json({ error: 'Failed to clear existing course content', details: deleteError.message }, { status: 500 })
    }
}
```

**Resultado:** El endpoint ahora es **idempotente**. Publicar el mismo curso N veces produce exactamente 1 copia de cada módulo, lección, actividad y material.

---

## 4. Impacto del Fix en Datos de Usuarios

### ⚠️ Advertencia importante

El fix elimina los módulos y lecciones existentes antes de reinsertar. Los registros de progreso de usuarios que apuntan a los `lesson_id` eliminados quedan **huérfanos** (orphaned). Esto significa:

- `user_lesson_progress` con `lesson_id` antiguo → registro huérfano (no visible, no borrado)
- `lia_activity_completions` con `activity_id` antiguo → registro huérfano
- `user_quiz_submissions` con `activity_id` o `material_id` antiguo → registro huérfano

**Para el estado actual del proyecto:** esto es aceptable dado que los cursos de CourseEngine son contenido en construcción/actualización frecuente. Una vez que un curso esté publicado y con usuarios activos con progreso real, hay que evaluar si se prefiere una estrategia de upsert por clave natural en lugar de delete+reinsert.

**Estrategia a largo plazo recomendada:** Ver sección 6.

---

## 5. Limpieza de Datos Duplicados Existentes

Los datos ya duplicados en producción deben limpiarse manualmente. Para cada curso afectado, ejecutar en Supabase SQL Editor:

```sql
-- 1. Identificar el curso afectado
SELECT id, title, slug, created_at
FROM courses
WHERE slug = 'SLUG_DEL_CURSO_AFECTADO';

-- 2. Ver módulos duplicados
SELECT module_id, module_title, module_order_index, created_at
FROM course_modules
WHERE course_id = 'ID_DEL_CURSO'
ORDER BY module_order_index, created_at;

-- 3. Para cada module_order_index duplicado, conservar solo el más reciente
-- y eliminar los anteriores. Las FK CASCADE limpiarán lecciones/actividades/materiales.
DELETE FROM course_modules
WHERE course_id = 'ID_DEL_CURSO'
  AND module_id NOT IN (
    SELECT DISTINCT ON (module_order_index) module_id
    FROM course_modules
    WHERE course_id = 'ID_DEL_CURSO'
    ORDER BY module_order_index, created_at DESC
  );

-- 4. Verificar que quedó limpio
SELECT module_order_index, COUNT(*) as copies
FROM course_modules
WHERE course_id = 'ID_DEL_CURSO'
GROUP BY module_order_index
HAVING COUNT(*) > 1;
-- Debe retornar 0 filas.
```

---

## 6. Qué Debe Revisarse en CourseEngine

El fix de SofLIA resuelve el problema de duplicación de forma robusta. Sin embargo, hay aspectos en el lado de CourseEngine que conviene revisar para garantizar una integración correcta y sin fricciones.

### 6.1 ✅ CRÍTICO: El campo `slug` debe ser siempre explícito y estable

**Situación actual en SofLIA:**

```typescript
let slug = courseData.slug
if (!slug) {
    // Se genera: "titulo-del-curso-4823"  (con sufijo de timestamp)
    slug = courseData.title.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4)
}
```

Si CourseEngine **no envía** el campo `slug` en el payload, cada re-publicación genera un slug diferente (por el sufijo timestamp). Esto crea **cursos completamente nuevos** en lugar de actualizar el existente.

**Regla:**

> CourseEngine DEBE incluir siempre el campo `course.slug` en el payload de importación. El slug debe ser determinista y estable: derivado del `artifact_id` o de un identificador permanente del curso, no del título con timestamp.

**Ejemplo de slug válido:**
```json
{
  "source": { "artifact_id": "curso-trampa-insolvencia-2026" },
  "course": {
    "slug": "curso-trampa-insolvencia-2026",
    ...
  }
}
```

**Ejemplo incorrecto (sin slug):**
```json
{
  "course": {
    "title": "La Trampa de la Insolvencia 2026"
    // sin slug → se genera "la-trampa-de-la-insolvencia-2026-4823" diferente cada vez
  }
}
```

### 6.2 ✅ RECOMENDADO: Consistencia en `activity_order_index` y `material_order_index`

El fix actual hace delete+reinsert en cada re-importación. Para que la estrategia de "conservar progreso de usuario entre re-imports" sea viable en el futuro (ver 6.3), los índices de orden deben ser **estables entre publicaciones**.

Si CourseEngine reorganiza el orden de actividades/materiales entre versiones, el mapeo de IDs antiguos a nuevos se rompe.

**Regla:** Si el contenido de una actividad se actualiza (no se reorganiza), mantener el mismo `order` en el payload.

### 6.3 💡 OPCIONAL A FUTURO: Estrategia de upsert por clave natural

Para cuando los cursos tengan usuarios con progreso real y no sea deseable borrar y recrear el contenido, se puede implementar una estrategia de upsert que preserve los IDs existentes:

**Requiere:**
- Un campo `external_id` o `source_id` en el payload de cada módulo, lección, actividad y material (generado por CourseEngine, estable entre versiones)
- Una columna `source_id` en las tablas de SofLIA para guardar ese identificador externo
- Lógica de upsert por `(course_id, source_id)` en lugar de delete+reinsert

**Ejemplo de payload futuro:**
```json
{
  "modules": [
    {
      "id": "mod-diagnostico-crisis",      ← ID estable generado por CourseEngine
      "title": "Diagnóstico de la Crisis",
      "order_index": 0,
      "lessons": [
        {
          "id": "les-trampa-insolvencia",  ← ID estable
          "title": "La trampa de la insolvencia",
          "activities": [
            {
              "id": "act-quiz-control-digital",  ← ID estable
              "title": "Quiz: Control Digital",
              "type": "quiz"
            }
          ]
        }
      ]
    }
  ]
}
```

Esto es una mejora de largo plazo que no es urgente dado el fix actual.

### 6.4 ✅ VERIFICAR: Que no se re-publiquen cursos innecesariamente

El fix de SofLIA borra y recrea el contenido en cada re-import. Si CourseEngine envía el payload completo del curso ante cualquier cambio menor (ej. corregir un typo en la descripción de una actividad), se borran y recrean todos los módulos/lecciones.

**Recomendación:** CourseEngine debería disparar una publicación completa solo cuando haya cambios estructurales o de contenido significativos, no ante cambios de metadata. Si hay una API granular en SofLIA para actualizar campos individuales (título del curso, thumbnail, etc.), usarla en lugar de re-importar el curso completo.

---

## 7. Contrato del Payload de Importación (Estado Actual)

Endpoint: `POST /api/courses/import`  
Auth: Header `x-api-key: {COURSEFORGE_API_KEY}`

```typescript
{
  source: {
    platform: string,          // ej. "courseforge"
    version: string,           // ej. "2.1.0"
    artifact_id: string,       // ID único del artefacto generado
  },
  course: {
    title: string,
    description: string,
    slug: string,              // ← OBLIGATORIO para idempotencia. Debe ser estable.
    category?: string,         // default: "General"
    level?: string,            // default: "beginner"
    instructor_email?: string,
    thumbnail_url?: string | null,
    is_published?: boolean,
  },
  modules: Array<{
    title: string,
    description?: string,
    order_index: number,       // base 0
    lessons: Array<{
      title: string,
      order_index: number,     // base 0
      summary?: string,
      transcription?: string,
      video_url?: string,
      duration?: number,       // segundos
      materials?: Array<{
        title: string,
        type: "link" | "download" | "pdf" | "document" | "quiz",
        url?: string,
        description?: string,
        data?: Record<string, unknown>,
      }>,
      activities?: Array<{
        title: string,
        type: "quiz" | "lia_script" | "puzzle" | "reflection",
        data: Record<string, unknown>,
      }>,
    }>,
  }>,
}
```

**Tipos de quiz (`data` para `type: "quiz"`):**

```typescript
{
  questions: Array<{
    id?: string,
    question: string,
    questionType: "multiple_choice" | ...,
    options: string[],
    correctAnswer: string | number,  // índice numérico o texto exacto
    explanation?: string,
    points?: number,
  }>,
  passing_score?: number,  // porcentaje, default 80
}
```

**Nota sobre `correctAnswer`:** SofLIA acepta tanto el índice numérico (`0`, `1`, `2`...) como el texto exacto de la opción. Si llega un índice numérico, se convierte automáticamente al texto de la opción correspondiente.

---

## 8. Respuestas del Endpoint

| Scenario | Status | Body |
|---|---|---|
| Importación exitosa (nuevo curso) | 200 | `{ success: true, course_id: "...", message: "..." }` |
| Re-importación exitosa (curso existente actualizado) | 200 | `{ success: true, course_id: "...", message: "..." }` |
| Ping de conexión | 200 | `{ message: "Pong: Connection Successful" }` |
| API Key inválida | 401 | `{ error: "Unauthorized..." }` |
| Payload JSON inválido | 400 | `{ error: "Invalid JSON body" }` |
| Error de validación Zod | 400 | `{ error: "Validation Error", details: {...} }` |
| Error al limpiar contenido anterior | 500 | `{ error: "Failed to clear existing course content" }` |
| Error al insertar módulos | 500 | `{ error: "Partial processing failure. Rolled back." }` |

---

## 9. Resumen de Acciones

### SofLIA Learning (ya corregido)

- [x] Fix aplicado en `apps/web/src/app/api/courses/import/route.ts`
- [x] Limpieza de datos duplicados confirmada: la query de diagnóstico devolvió solo `CONSERVAR` — el fix de SofLIA ya limpió los duplicados en la última re-publicación

### CourseEngine (corregido el 2026-04-20)

- [x] **CRÍTICO:** Slug siempre presente y estable — ver sección 10
- [ ] **RECOMENDADO:** Revisar frecuencia de re-publicaciones; evitar publicaciones innecesarias
- [ ] **RECOMENDADO:** Mantener consistencia de `order_index` entre versiones del mismo curso
- [ ] **FUTURO:** Considerar incluir `id` estable por módulo/lección/actividad en el payload para permitir upsert granular en SofLIA

---

## 10. Fix Aplicado en CourseEngine (2026-04-20)

### Problema que resuelve

Si el formulario de publicación se enviaba sin llenar el campo **Slug URL**, SofLIA recibía `slug: ""` y generaba automáticamente un slug con sufijo timestamp (ej. `la-trampa-de-la-insolvencia-2026-4823`). Como el timestamp cambia en cada llamada, cada re-publicación creaba un curso completamente nuevo en lugar de actualizar el existente.

### Archivos modificados

#### `apps/web/src/domains/publication/lib/publication-client.ts`

**Cambio:** Se agregó la función `generateSlugFromTitle(title: string): string`.

**Qué hace:** Convierte el título del artefacto en un slug URL-safe, determinista y sin timestamp:
- Normaliza acentos (`é` → `e`)
- Convierte a minúsculas
- Reemplaza cualquier carácter no alfanumérico por `-`
- Elimina guiones al inicio/final
- Trunca a 80 caracteres

**Por qué no tiene timestamp:** El slug es la clave de idempotencia en SofLIA. Si cambia entre publicaciones, SofLIA lo trata como un curso nuevo. El timestamp en el slug de SofLIA era un fallback para cuando no llegaba slug — ahora CourseEngine siempre envía uno estable.

```typescript
export function generateSlugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}
```

---

#### `apps/web/src/app/admin/artifacts/[id]/publish/PublicationClientView.tsx`

**Cambios:**

1. **Auto-sugerencia de slug al abrir el formulario.** En el `useState` inicial, si no hay slug guardado en el borrador, se llama `generateSlugFromTitle(artifactTitle)` para pre-poblarlo. El usuario puede editarlo manualmente antes de guardar.

   ```typescript
   if (!initial.slug && artifactTitle) {
     initial.slug = generateSlugFromTitle(artifactTitle);
   }
   ```

2. **Flags de validación granulares.** En lugar de un booleano `isMetadataComplete`, ahora se calculan tres flags independientes:

   ```typescript
   const missingEmail     = !courseData.instructor_email;
   const missingSlug      = !courseData.slug;
   const missingThumbnail = !courseData.thumbnail_url;
   const isMetadataComplete = !missingEmail && !missingSlug && !missingThumbnail;
   ```

   Estos flags se pasan a `PublicationAlerts` para mostrar mensajes específicos por campo.

---

#### `apps/web/src/app/admin/artifacts/[id]/publish/components/PublicationAlerts.tsx`

**Cambio:** Se reemplazó la prop `isMetadataComplete: boolean` por tres props granulares: `missingEmail`, `missingSlug`, `missingThumbnail`.

**Por qué:** El mensaje anterior decía genéricamente *"Completa el email del instructor, slug y thumbnail"* aunque el usuario ya hubiera llenado dos de los tres campos. Ahora el banner lista solo los que realmente faltan, y el mensaje del slug incluye una nota explicando que debe ser estable entre publicaciones.

**Interfaz actualizada:**
```typescript
interface PublicationAlertsProps {
  missingEmail: boolean;
  missingSlug: boolean;
  missingThumbnail: boolean;
  missingVideos: number;
  selectedLessonsCount: number;
  selectableLessonsCount: number;
}
```

---

#### `apps/web/src/app/api/publish/route.ts`

**Cambio:** Se agregó validación server-side del slug antes de construir el payload y depositarlo en el buzón de SofLIA.

**Por qué aquí además del cliente:** La validación del formulario es UI y puede ser bypaseada (llamada directa a la API, estado corrupto en BD, etc.). El servidor es la última línea de defensa antes de que un slug vacío llegue a SofLIA.

```typescript
if (!publicationRequest.slug?.trim()) {
  return NextResponse.json(
    { error: 'El slug del curso es obligatorio para publicar...' },
    { status: 400 },
  );
}
```

**Posición en el flujo:** El check ocurre después de validar `status === 'READY'` y antes de llamar a `buildPublicationPayload()`. Si el slug está vacío, la función retorna 400 sin tocar SofLIA.

### Qué NO cambió

- La estructura del payload enviado a SofLIA (misma forma, mismos campos)
- La lógica de video mappings y selección de lecciones
- El endpoint `/api/save-draft`
- Cualquier otra página, dominio o función del pipeline

### Cómo probarlo

1. Crear un artefacto nuevo y navegar a la pestaña de publicación → el slug debe aparecer pre-poblado desde el título
2. Borrar el slug manualmente → el banner de alerta debe mostrar solo el item del slug
3. Intentar publicar sin slug (borrando el campo y llamando directo a `/api/publish`) → debe retornar `400` con mensaje claro
4. Publicar el mismo curso dos veces con el mismo slug → SofLIA debe actualizar el curso existente, no crear uno nuevo

---

*Documento generado el 2026-04-20. Última actualización: 2026-04-20. Contacto técnico SofLIA: pedro.echeverria@pulsehub.mx*
