# Plan de Implementación: Publicación vía Patrón "Inbox"

## Problema

El flujo actual de publicación hace un HTTP POST desde SofLIA CourseEngine a `SofLIA/api/courses/import`.
Esto falla con **403 WAF** porque la infraestructura de SofLIA bloquea peticiones externas entrantes.

## Solución

Eliminar la comunicación HTTP y reemplazarla por una **escritura directa a Supabase** (base de datos compartida).

```
SofLIA CourseEngine            Supabase de SofLIA
───────────────────            ──────────────────
/api/publish  ──── UPSERT ───► courseengine_inbox
                                      │
                                      ▼ (cada 5 min)
                              Netlify Cron Job
                                      │
                                      ▼
                              courses / modules / lessons
```

**Ventaja adicional**: Soporta actualizaciones transparentes por `course_slug` (UPSERT idempotente).

---

## Repositorios involucrados

- **SofLIA CourseEngine**: `c:\Users\Lordg\Desktop\Pulse Hub\SofLIA - CourseGen\courseforge`
- **SofLIA-Learning**: `C:\Users\Lordg\Desktop\Pulse Hub\SofLIA - Learning\SofLIA-Learning`

---

## PASO 1 — Base de datos en SofLIA (SQL manual en Supabase Dashboard)

**Dónde**: Supabase Dashboard del proyecto de SofLIA → SQL Editor

```sql
CREATE TABLE public.courseengine_inbox (
    course_slug  VARCHAR PRIMARY KEY,
    payload      JSONB NOT NULL,
    status       VARCHAR DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processed', 'error')),
    error_message TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para que el cron solo lea filas pendientes eficientemente
CREATE INDEX idx_courseengine_inbox_pending
    ON public.courseengine_inbox(status)
    WHERE status = 'pending';
```

**Seguridad**: RLS deshabilitado. El acceso es exclusivamente server-to-server via Service Role Key.

---

## PASO 2 — SofLIA CourseEngine (el emisor)

### 2a. Variables de entorno

**Archivo**: `apps/web/.env.local`

**Agregar:**
```env
SOFLIA_INBOX_SUPABASE_URL=<URL del proyecto Supabase de SofLIA>
SOFLIA_INBOX_SUPABASE_KEY=<Service Role Key del proyecto Supabase de SofLIA>
```

**Eliminar** (ya no se usan):
```env
SOFLIA_API_URL=...
SOFLIA_API_KEY=...
```

### 2b. Modificar endpoint de publicación

**Archivo**: `apps/web/src/app/api/publish/route.ts`

**Cambios:**
1. Importar `createClient` de `@supabase/supabase-js` (directo, no el wrapper de la app)
2. Reemplazar validación de `SOFLIA_API_URL`/`SOFLIA_API_KEY` por las nuevas vars
3. Eliminar el bloque `fetch(targetUrl, { method: 'POST', ... })`
4. Reemplazar por UPSERT a `courseengine_inbox`:

```typescript
import { createClient } from '@supabase/supabase-js';

// Dentro del handler, después de construir outPayload:
const sofliaSupabase = createClient(
  process.env.SOFLIA_INBOX_SUPABASE_URL!,
  process.env.SOFLIA_INBOX_SUPABASE_KEY!
);

const { error: inboxError } = await sofliaSupabase
  .from('courseengine_inbox')
  .upsert(
    {
      course_slug:   pubRequest.slug,
      payload:       outPayload,
      status:        'pending',
      error_message: null,
      updated_at:    new Date().toISOString(),
    },
    { onConflict: 'course_slug' }
  );

if (inboxError) {
  throw new Error(`Error insertando en buzón de SofLIA: ${inboxError.message}`);
}
```

### 2c. Crear endpoint faltante

**Archivo**: `apps/web/src/app/api/trigger-publish/route.ts` ← **NUEVO** (no existe actualmente)

La UI llama a este endpoint pero no existe. Crear un wrapper que invoque la lógica de `/api/publish`:

```typescript
// POST /api/trigger-publish
// Body: { artifactId: string }
```

La implementación puede ser:
- Importar y reutilizar el handler de `/api/publish/route.ts` directamente, o
- Hacer un fetch interno a `/api/publish` con el mismo body

---

## PASO 3 — SofLIA (el receptor)

### 3a. Crear endpoint de cron

**Archivo**: `apps/web/src/app/api/cron/process-inbox/route.ts` ← **NUEVO**

**Lógica:**
1. Validar header de autorización (`Authorization: Bearer ${CRON_SECRET}`)
2. Query: `SELECT * FROM courseengine_inbox WHERE status = 'pending' LIMIT 5`
3. Por cada fila:
   - Parsear `payload` (JSONB)
   - Reutilizar la lógica de `api/courses/import/route.ts` para hacer UPSERT en:
     - `courses` (por `slug`)
     - `course_modules` (por `course_id` + `order_index`)
     - `course_lessons` (por `module_id` + `order_index`)
     - `lesson_materials`
     - `lesson_activities`
   - Si éxito: `UPDATE courseengine_inbox SET status = 'processed', updated_at = now()`
   - Si error: `UPDATE courseengine_inbox SET status = 'error', error_message = '...', updated_at = now()`
4. Retornar resumen: `{ processed: N, errors: M }`

### 3b. Crear Netlify Function programada

**Archivo**: `netlify/functions/process-inbox.ts` ← **NUEVO**

Patrón idéntico a `process-inactive-lessons.ts`. Llama al endpoint cron con el header secreto.

### 3c. Registrar en netlify.toml

**Archivo**: `netlify.toml` (raíz de SofLIA)

Agregar:
```toml
[functions."process-inbox"]
  schedule = "*/5 * * * *"
```

---

## PASO 4 — Idempotencia en SofLIA

**Estrategia**: UPSERT por índice de orden (conserva IDs y progreso de estudiantes).

### 4a. Migración SQL adicional en SofLIA

```sql
ALTER TABLE public.course_modules
  ADD CONSTRAINT uq_module_course_order
  UNIQUE (course_id, module_order_index);

ALTER TABLE public.course_lessons
  ADD CONSTRAINT uq_lesson_module_order
  UNIQUE (module_id, lesson_order_index);
```

### 4b. Cambios en `import/route.ts`

- `courses`: UPSERT con `onConflict: 'slug'`
- `course_modules`: UPSERT con `onConflict: 'course_id,module_order_index'`
- `course_lessons`: UPSERT con `onConflict: 'module_id,lesson_order_index'`
- `lesson_materials` y `lesson_activities`: borrar y reinsertar (no tienen progreso de usuario directo)

---

## Variables de entorno requeridas

### En SofLIA CourseEngine (`apps/web/.env.local`)
| Variable | Descripción |
|----------|-------------|
| `SOFLIA_INBOX_SUPABASE_URL` | URL del proyecto Supabase de SofLIA |
| `SOFLIA_INBOX_SUPABASE_KEY` | Service Role Key del proyecto Supabase de SofLIA |

### En SofLIA
| Variable | Descripción |
|----------|-------------|
| `CRON_SECRET` | Secreto compartido para proteger el endpoint `/api/cron/process-inbox` |

---

## Verificación end-to-end

1. Ir a CourseEngine `/admin/artifacts/[id]/publish`, completar formulario, click en **Publish**
2. Verificar en Supabase de SofLIA que aparece fila en `courseengine_inbox` con `status = 'pending'`
3. Llamar manualmente `GET /api/cron/process-inbox` con header `Authorization: Bearer <CRON_SECRET>`
4. Verificar que la fila pasa a `status = 'processed'`
5. Verificar que el curso aparece en `courses` / `course_modules` / `course_lessons`
6. Publicar el mismo slug nuevamente → debe **actualizar**, no duplicar
