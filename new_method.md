# Plan de Implementación: Publicación de Talleres vía Patrón "Inbox"

## Objetivo
Sustituir el envío de peticiones HTTP POST (que causan los errores 403 por bloqueos del WAF) por una conexión de base de datos directa y segura (utilizando una fila por taller en una tabla "buzón"). Este plan está diseñado para evitar rupturas de esquema (Schema Drift) y soportar la actualización transparente de los cursos.

## Paso 1: Configurar la Base de Datos (en el proyecto de SofLIA)

Debemos crear el "buzón de entrada" en la base de datos de **SofLIA** (usando el SQL Editor de Supabase o migraciones).

```sql
CREATE TABLE public.courseforge_inbox (
    course_slug VARCHAR PRIMARY KEY, -- Usamos el slug como identificador único para soportar actualizaciones
    payload JSONB NOT NULL,          -- Aquí vivirá el JSON gigante completo
    status VARCHAR DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'error')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS) pero permitir acceso via service role,
-- o crear las políticas necesarias según el modelo de seguridad de Supabase en SofLIA.
```

Opcional pero recomendado para seguridad (Least Privilege):
Crear un acceso restringido (por ejemplo, proporcionar el `SERVICE_ROLE_KEY` o crear un rol específico en postgres) que CourseForge usará, asegurando que solo tenga permisos sobre esta nueva tabla.

## Paso 2: Adaptar CourseForge (El Emisor)

**Archivos afectados principales:**
1. `.env` (de CourseForge)
2. [apps/web/src/app/api/publish/route.ts](file:///c:/Users/Lordg/Desktop/Pulse%20Hub/SofLIA%20-%20CourseGen/courseforge/apps/web/src/app/api/publish/route.ts) (de CourseForge)

**Acciones a realizar:**
1. En CourseForge, definir nuevas variables de entorno para conectarse al Supabase de SofLIA en lugar de usar la URL de la API:
   - `SOFLIA_INBOX_SUPABASE_URL`
   - `SOFLIA_INBOX_SUPABASE_KEY` (Idealmente Service Role Key, ya que la inserción es server-to-server).
2. En [route.ts](file:///c:/Users/Lordg/Desktop/Pulse%20Hub/SofLIA%20-%20CourseGen/courseforge/apps/web/src/app/api/lia/route.ts), **eliminar la petición `fetch`** al endpoint `/api/courses/import`.
3. En su lugar, inicializar un segundo cliente de Supabase apuntando al proyecto de SofLIA.
4. Una vez generado el `outPayload` completo, realizar un **UPSERT** en la tabla `courseforge_inbox`.

**Ejemplo de código a implementar en [route.ts](file:///c:/Users/Lordg/Desktop/Pulse%20Hub/SofLIA%20-%20CourseGen/courseforge/apps/web/src/app/api/lia/route.ts):**
```typescript
import { createClient } from '@supabase/supabase-js';

// Inicializar cliente apuntando a la BD de SofLIA
const sofliaSupabase = createClient(
  process.env.SOFLIA_INBOX_SUPABASE_URL!,
  process.env.SOFLIA_INBOX_SUPABASE_KEY!
);

// En lugar de fetch(targetUrl, {...}), hacemos la inserción directa
const { error: inboxError } = await sofliaSupabase
  .from('courseforge_inbox')
  .upsert({
      course_slug: pubRequest.slug,
      payload: outPayload,
      status: 'pending', // Volver a poner 'pending' fuerza a SofLIA a reprocesarlo si es una actualización
      error_message: null,
      updated_at: new Date().toISOString()
  }, {
      onConflict: 'course_slug' // Clave para manejar actualizaciones
  });

if (inboxError) {
    throw new Error(`Error insertando en el buzón de SofLIA: ${inboxError.message}`);
}
```

## Paso 3: Adaptar SofLIA (El Receptor/Ingestión)

SofLIA necesita un mecanismo para leer los JSONs depositados en `courseforge_inbox` y transformarlos a sus tablas reales (`courses`, `modules`, `lessons`). 

Existen dos vías para accionar esto. La más sencilla (sin configurar webhooks de base de datos complicados) es un **Cron Job o Endpoint Protegido**:

**Acciones a realizar:**
1. Crear un nuevo endpoint en SofLIA, por ejemplo: `app/api/cron/process-inbox/route.ts`.
2. Lógica del endpoint interno:
   - Buscar cursos pendientes: `SELECT * FROM courseforge_inbox WHERE status = 'pending' LIMIT 5`.
   - Iterar sobre ellos y utilizar la **lógica exacta** que ya existe en tu antiguo `courses/import` para parsear el `payload` (JSONB) e insertarlo/actualizarlo en las tablas relacionales de SofLIA.
   - Si el procesamiento es **exitoso**, hacer un UPDATE en el buzón: `UPDATE courseforge_inbox SET status = 'processed' WHERE course_slug = '...'`.
   - Si hay **error**, registrarlo: `UPDATE courseforge_inbox SET status = 'error', error_message = '...error...'`.
3. Automatizar la ejecución de este endpoint (Ej. usar Vercel Cron configurado cada 5 minutos, o dispararlo manualmente para pruebas).

## Paso 4: Limpieza e Idempotencia (SofLIA)

- **Importante para que funcionen las actualizaciones:** La lógica de SofLIA que traslada del JSON a sus tablas internas **debe usar UPSERT**.
- Si el curso ya existe (mismo slug), no debe fallar diciendo "el curso ya existe", sino que debe actualizar el título, reemplazar las lecciones modificadas, etc.
- Una vez funcionando al 100%, eliminar el viejo script `/api/courses/import` de SofLIA ya que será código obsoleto e inseguro.

---
**Instrucción para Claude Code:** Puedes pasar este archivo Markdown directamente a Claude Code como Prompt de plan de ingeniería, pidiéndole que ejecute las modificaciones comenzando por el Paso 2 en este repositorio (CourseForge).
