# Plan: Revisión de Actualizaciones con Staging (Opción B)

## Contexto

### Problema actual (Opción A — implementada)

Cuando CourseEngine publica una **actualización** de un curso ya aprobado, el cron
`process-inbox` sobreescribe directamente los datos en `courses`, `course_modules` y
`course_lessons`, y pone `is_active = false`. Esto significa que:

- El curso se cae de línea inmediatamente para los estudiantes.
- Si el admin rechaza la actualización, el contenido sobreescrito ya no es reversible.
- Opción A mitiga el "caer de línea" restaurando `is_active = true` al rechazar, pero
  los datos del curso ya fueron reemplazados por los nuevos.

### Solución correcta (Opción B — pendiente)

Separar el flujo de **nuevos cursos** del flujo de **actualizaciones**:

- **Nuevo**: se crea directamente en `courses` (como hoy).
- **Actualización**: los datos nuevos se guardan en tablas de _staging_ (`courses_staging`,
  `course_modules_staging`, `course_lessons_staging`). El curso original permanece
  **intacto y publicado** hasta que el admin apruebe o rechace.

---

## Cambios de Base de Datos

### 1. Nuevas tablas de staging

```sql
-- Curso en revisión (solo metadata del curso, no módulos/lecciones aún)
CREATE TABLE public.courses_staging (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id       UUID REFERENCES public.courses(id) ON DELETE CASCADE,
    -- NULL si es curso nuevo (aún no existe en courses)
    -- NOT NULL si es actualización de curso existente
    source_slug     VARCHAR NOT NULL,         -- slug del curso en courseengine_inbox
    artifact_id     VARCHAR,                  -- source.artifact_id del payload
    payload         JSONB NOT NULL,           -- payload completo de courseengine_inbox
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    status          VARCHAR DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by     UUID REFERENCES public.users(id),
    reviewed_at     TIMESTAMPTZ,
    rejection_reason TEXT,
    is_update       BOOLEAN DEFAULT false     -- true si actualiza un curso existente
);

CREATE INDEX idx_courses_staging_status ON public.courses_staging(status)
    WHERE status = 'pending';
CREATE INDEX idx_courses_staging_course_id ON public.courses_staging(course_id);
CREATE INDEX idx_courses_staging_source_slug ON public.courses_staging(source_slug);
```

> **No se necesitan** tablas separadas para módulos/lecciones en staging: el `payload`
> JSONB completo ya contiene toda la estructura. Se aplica al aprobar.

---

## Cambios en process-inbox (CourseEngine → SofLIA)

### Archivo: `apps/web/src/app/api/cron/process-inbox/route.ts`

**Lógica actual:**

```
inbox row → UPSERT courses + modules + lessons → processed
```

**Nueva lógica:**

```
inbox row
  ├── ¿Existe courses.slug?
  │     ├── NO  → Crear curso directamente (mismo flujo actual)
  │     │         Insertar fila en courses_staging con is_update=false
  │     └── SÍ  → Insertar fila en courses_staging con is_update=true
  │                NO tocar courses / course_modules / course_lessons
  └── Marcar courseengine_inbox como 'processed'
```

**Pseudocódigo:**

```typescript
// 1. Verificar si el curso ya existe
const { data: existing } = await supabase
  .from("courses")
  .select("id")
  .eq("slug", slug)
  .single();

if (!existing) {
  // Flujo nuevo: crear course + modules + lessons como antes
  await createCourseFromPayload(supabase, payload, instructorId);
}

// 2. Siempre registrar en staging (nuevo o actualización)
await supabase.from("courses_staging").insert({
  course_id: existing?.id ?? null,
  source_slug: course_slug,
  artifact_id: payload.source.artifact_id,
  payload: payload,
  is_update: !!existing,
  status: "pending",
});
```

---

## Cambios en la UI de Revisiones

### Archivo: `apps/web/src/features/admin/actions/adminCourses.actions.ts`

**`getPendingCourses()`** — cambiar para leer de `courses_staging` en vez de `courses`:

```typescript
// Nuevo: leer desde courses_staging
const { data } = await supabase
  .from("courses_staging")
  .select(
    `
        id,
        course_id,
        source_slug,
        is_update,
        submitted_at,
        payload,
        status,
        course:courses!course_id (
            title, slug, thumbnail_url, level, category,
            instructor:users!fk_courses_instructor(first_name, last_name)
        )
    `,
  )
  .eq("status", "pending")
  .order("submitted_at", { ascending: false });

// Para cursos nuevos (is_update=false), course_id es null → leer metadata del payload
// Para actualizaciones (is_update=true), mostrar datos actuales del curso + vista previa del payload
```

### Página de detalle (`AdminPendingCourseDetailPage.tsx`)

Para actualizaciones, mostrar **comparación lado a lado**:

- Izquierda: datos actuales del curso publicado (`courses` / `course_modules` / `course_lessons`)
- Derecha: datos nuevos propuestos (del `payload` en `courses_staging`)

Esto permite al admin ver exactamente qué cambió antes de aprobar o rechazar.

---

## Cambios en las acciones de Aprobar / Rechazar

### `approveCourse(stagingId)`

```typescript
// 1. Leer el staging row
const { data: staging } = await supabase
    .from('courses_staging').select('*').eq('id', stagingId).single()

if (staging.is_update) {
    // Aplicar payload al curso existente (UPSERT modules/lessons)
    await applyPayloadToCourse(supabase, staging.course_id, staging.payload)
    await supabase.from('courses')
        .update({ is_active: true, approval_status: 'approved', ... })
        .eq('id', staging.course_id)
} else {
    // Curso nuevo: crear course + modules + lessons desde payload
    const newCourse = await createCourseFromPayload(supabase, staging.payload, instructorId)
    await supabase.from('courses')
        .update({ is_active: true, approval_status: 'approved' })
        .eq('id', newCourse.id)
}

// Marcar staging como aprobado
await supabase.from('courses_staging')
    .update({ status: 'approved', reviewed_at: now, reviewed_by: adminId })
    .eq('id', stagingId)
```

### `rejectCourse(stagingId, reason)`

```typescript
// Solo marcar staging como rechazado — el curso original NO se toca
await supabase
  .from("courses_staging")
  .update({
    status: "rejected",
    rejection_reason: reason,
    reviewed_at: now,
    reviewed_by: adminId,
  })
  .eq("id", stagingId);

// Si es update: el curso original sigue publicado con is_active=true (no se modifica)
// Si es nuevo: simplemente no se crea el curso
```

---

## Archivos a Crear / Modificar

| Archivo                                                                   | Acción    | Descripción                                                         |
| ------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `supabase/migrations/YYYYMMDD_courses_staging.sql`                        | Crear     | Tabla `courses_staging`                                             |
| `apps/web/src/app/api/cron/process-inbox/route.ts`                        | Modificar | Lógica de staging en vez de UPSERT directo                          |
| `apps/web/src/features/admin/actions/adminCourses.actions.ts`             | Modificar | Leer de `courses_staging`, aprobar/rechazar aplica/descarta payload |
| `apps/web/src/features/admin/components/AdminPendingCoursesPage.tsx`      | Modificar | Adaptar a nueva estructura de `courses_staging`                     |
| `apps/web/src/features/admin/components/AdminPendingCourseDetailPage.tsx` | Modificar | Vista diff para actualizaciones (actual vs propuesto)               |
| `apps/web/src/features/admin/hooks/useAdminPendingCourses.ts`             | Modificar | Adaptar al nuevo tipo de datos                                      |

---

## Función auxiliar reutilizable

Extraer `applyPayloadToCourse` como función compartida entre el flujo de nuevo (aprobación
inmediata) y el flujo de actualización (aprobación después de revisión):

```typescript
// lib/courseImport.ts (nuevo archivo compartido)
export async function applyPayloadToCourse(
  supabase: SupabaseClient,
  courseId: string,
  payload: CourseImportPayload,
): Promise<void> {
  // UPSERT modules con onConflict: 'course_id,module_order_index'
  // UPSERT lessons con onConflict: 'module_id,lesson_order_index'
  // DELETE + INSERT materials y activities
}
```

---

## Consideraciones de Migración

1. Los cursos existentes en `courses` con `approval_status = 'pending'` (creados con
   Opción A) deben migrarse manualmente a `courses_staging` antes del go-live de Opción B.

2. La tabla `courseengine_inbox` puede seguir usándose como cola de entrada; solo cambia
   lo que hace el cron al procesar cada fila.

3. El campo `courseengine_inbox.status = 'processed'` sigue significando "fue leído y
   registrado en staging", no "fue aprobado".

---

## Estimación de Alcance

- **Bajo**: Migración SQL + modificar `process-inbox/route.ts`
- **Medio**: Modificar `adminCourses.actions.ts` + hooks
- **Alto**: Vista diff en `AdminPendingCourseDetailPage.tsx`

El mínimo viable (sin vista diff) puede hacerse sin tocar el componente de detalle,
mostrando solo los datos del payload en la vista actual.
