# Checklist de Implementación: Patrón Inbox

> Marcar cada ítem con `[x]` al completarlo. Los detalles y riesgos de cada paso están documentados debajo.

---

## PASO 1 — Base de datos en SofLIA

- [ ] **1.1** Ejecutar SQL de creación de `courseengine_inbox` en Supabase Dashboard de SofLIA
- [ ] **1.2** Verificar que la tabla aparece en el schema `public`
- [ ] **1.3** Verificar que el índice `idx_courseengine_inbox_pending` fue creado
- [ ] **1.4** Confirmar que RLS está deshabilitado (o que la Service Role Key tiene acceso sin restricciones)

**Posibles problemas:**
- Si SofLIA usa RLS global, puede que la inserción desde CourseEngine falle aunque uses Service Role Key. Verificar en `Table Editor → RLS → Policies`.
- Si `course_slug` ya existe en la tabla de una prueba anterior, el UPSERT lo sobreescribirá (comportamiento esperado).
- Asegurarse de copiar la **Service Role Key** (no la `anon key`) del dashboard de SofLIA: `Settings → API → service_role`.

---

## PASO 2 — SofLIA CourseEngine

### Variables de entorno

- [ ] **2.1** Agregar `SOFLIA_INBOX_SUPABASE_URL` a `apps/web/.env.local`
- [ ] **2.2** Agregar `SOFLIA_INBOX_SUPABASE_KEY` a `apps/web/.env.local`
- [ ] **2.3** (Opcional) Eliminar `SOFLIA_API_URL` y `SOFLIA_API_KEY` del `.env.local` si ya no se usan en ningún otro lugar

**Posibles problemas:**
- `@supabase/supabase-js` ya está instalado en el repo, pero si el `route.ts` importa del wrapper interno (`@/utils/supabase/server`), necesitaremos importar `createClient` directamente de `@supabase/supabase-js` para evitar usar las cookies de sesión del usuario.
- Confirmar que `SOFLIA_INBOX_SUPABASE_URL` tiene formato `https://<ref>.supabase.co` (sin trailing slash).

### Modificar `/api/publish/route.ts`

- [ ] **2.4** Agregar import de `createClient` de `@supabase/supabase-js`
- [ ] **2.5** Reemplazar validación de env vars (`SOFLIA_API_URL` / `SOFLIA_API_KEY`) por las nuevas
- [ ] **2.6** Eliminar el bloque `fetch(targetUrl, { method: 'POST', headers: {...}, body: ... })`
- [ ] **2.7** Agregar bloque de UPSERT a `courseengine_inbox`
- [ ] **2.8** Mantener el `UPDATE publication_requests SET status = 'SENT'` post-envío (ya estaba)
- [ ] **2.9** Ajustar el mensaje de respuesta del endpoint (ya no dice "enviado a SofLIA via HTTP" sino "depositado en buzón")

**Posibles problemas:**
- El `fetch` actual tiene un timeout de 60 segundos. El UPSERT a Supabase es mucho más rápido (< 1s), así que el timeout ya no aplica y se puede eliminar.
- Si el Service Role Key de SofLIA tiene restricciones de red/CORS, el UPSERT también puede fallar. Verificar en el dashboard de SofLIA que no hay restricciones de `allowed origins` para la Service Role Key.
- El `outPayload` puede ser muy grande (cursos con muchos módulos). Supabase acepta JSONB de hasta 1GB, no es un problema real.

### Crear `/api/trigger-publish/route.ts`

- [ ] **2.10** Crear el archivo `apps/web/src/app/api/trigger-publish/route.ts`
- [ ] **2.11** El endpoint recibe `POST { artifactId: string }`
- [ ] **2.12** Reutiliza la lógica del handler de `/api/publish` (importando directamente o haciendo fetch interno)
- [ ] **2.13** Retorna la misma estructura de respuesta que `/api/publish`

**Posibles problemas:**
- Si se hace un `fetch` interno a `/api/publish`, en local Next.js puede fallar porque el servidor no puede llamarse a sí mismo durante SSR. Mejor importar directamente la función handler o extraer la lógica a un módulo compartido.
- Verificar que `PublicationClientView.tsx` espera la misma forma de respuesta `{ success, message }` que retorna `/api/publish`.

---

## PASO 3 — SofLIA

### Crear `/api/cron/process-inbox/route.ts`

- [ ] **3.1** Crear directorio `apps/web/src/app/api/cron/process-inbox/`
- [ ] **3.2** Crear `route.ts` con handler GET (el cron lo llama via GET)
- [ ] **3.3** Implementar validación del header `Authorization: Bearer ${CRON_SECRET}`
- [ ] **3.4** Implementar query de filas pendientes (`LIMIT 5` para evitar timeouts)
- [ ] **3.5** Reutilizar lógica de parseo de `api/courses/import/route.ts`
- [ ] **3.6** Implementar UPSERT en `courses`, `course_modules`, `course_lessons`
- [ ] **3.7** Implementar DELETE + INSERT en `lesson_materials`, `lesson_activities`
- [ ] **3.8** Actualizar `courseengine_inbox` a `processed` o `error` según resultado
- [ ] **3.9** Retornar resumen `{ processed: N, errors: M, details: [...] }`

**Posibles problemas:**
- La lógica de `import/route.ts` espera el payload con validación Zod. Reutilizarla tal cual puede lanzar errores de validación si hay campos faltantes. Revisar el `CourseImportPayloadSchema` antes de migrar la lógica.
- Los UPSERTs en `courses` necesitan el `instructor_id` (FK a `users`). El JSON de CourseEngine envía `instructor_email`. Habrá que hacer un lookup de `users` por email para obtener el UUID, igual que hace el import existente.
- Si el cron procesa 5 cursos en paralelo y hay errores de FK, Supabase puede lanzar errores de constraint. Considerar procesar secuencialmente con `for...of` en lugar de `Promise.all`.
- El endpoint debe tener `export const runtime = 'nodejs'` si usa módulos que no son Edge-compatible.

### Crear Netlify Function programada

- [ ] **3.10** Crear `netlify/functions/process-inbox.ts`
- [ ] **3.11** Seguir el patrón de `process-inactive-lessons.ts`
- [ ] **3.12** Configurar la URL del endpoint: `${process.env.NEXT_PUBLIC_SITE_URL}/api/cron/process-inbox`
- [ ] **3.13** Incluir el header `Authorization: Bearer ${CRON_SECRET}`
- [ ] **3.14** Agregar `CRON_SECRET` a variables de entorno de SofLIA (Netlify Dashboard)

**Posibles problemas:**
- La `NEXT_PUBLIC_SITE_URL` (o equivalente) debe estar configurada en el entorno de Netlify de SofLIA. Revisar cómo la obtiene `process-inactive-lessons.ts`.
- Si Netlify Functions tienen un timeout de 10 segundos para scheduled functions, asegurarse de que el endpoint responda antes de ese límite (procesar solo 5 cursos por ejecución ayuda).

### Modificar `netlify.toml`

- [ ] **3.15** Agregar bloque `[functions."process-inbox"]` con `schedule = "*/5 * * * *"`

---

## PASO 4 — Idempotencia en SofLIA

**Estrategia elegida: UPSERT por índice de orden** (conserva IDs y progreso de estudiantes)

#### Migración adicional en SofLIA (SQL manual en Supabase Dashboard)

- [ ] **4.0a** Ejecutar en Supabase de SofLIA:
  ```sql
  -- Permite UPSERT de módulos por posición dentro del curso
  ALTER TABLE public.course_modules
    ADD CONSTRAINT uq_module_course_order
    UNIQUE (course_id, module_order_index);

  -- Permite UPSERT de lecciones por posición dentro del módulo
  ALTER TABLE public.course_lessons
    ADD CONSTRAINT uq_lesson_module_order
    UNIQUE (module_id, lesson_order_index);
  ```
- [ ] **4.0b** Verificar que las constraints se crearon sin errores (no deben existir duplicados previos)

#### Cambios en código

- [ ] **4.1** Cambiar INSERT de `courses` por UPSERT con `onConflict: 'slug'`
- [ ] **4.2** Cambiar INSERT de `course_modules` por UPSERT con `onConflict: 'course_id,module_order_index'`
- [ ] **4.3** Cambiar INSERT de `course_lessons` por UPSERT con `onConflict: 'module_id,lesson_order_index'`
- [ ] **4.4** Para `lesson_materials` y `lesson_activities`: borrar y reinsertar los de la lección (no tienen progreso de usuario asociado directamente)

**Posibles problemas:**
- Si ya hay módulos duplicados por `(course_id, module_order_index)` en la BD actual, el `ADD CONSTRAINT` fallará. Hay que limpiar duplicados primero con: `SELECT course_id, module_order_index, COUNT(*) FROM course_modules GROUP BY 1,2 HAVING COUNT(*) > 1`.
- Lo mismo para `course_lessons`.
- Si se cambia el orden de un módulo entre publicaciones (ej: módulo 2 pasa a ser módulo 1), el UPSERT actualizará el módulo en posición 1 con el contenido nuevo, que puede no ser lo esperado. Aceptable para el caso de uso actual.

---

## PASO 5 — Verificación

- [ ] **5.1** Test local: publicar un curso desde CourseEngine UI
- [ ] **5.2** Confirmar fila en `courseengine_inbox` con `status = 'pending'`
- [ ] **5.3** Llamar `GET /api/cron/process-inbox` manualmente y verificar respuesta `{ processed: 1 }`
- [ ] **5.4** Confirmar `status = 'processed'` en `courseengine_inbox`
- [ ] **5.5** Confirmar curso en tablas de SofLIA
- [ ] **5.6** Republicar mismo curso (actualización) → confirmar que no hay duplicado en `courses`
- [ ] **5.7** Test con error: forzar un payload inválido → confirmar `status = 'error'` con mensaje
- [ ] **5.8** Verificar que el cron de Netlify se ejecuta automáticamente cada 5 minutos en staging

---

## Notas finales

- El endpoint `/api/debug/soflia/route.ts` en CourseEngine prueba la conexión HTTP al import de SofLIA. Después de este cambio, ese debug ya no aplica. Considerar actualizarlo para verificar la conexión al Supabase de SofLIA directamente.
- Una vez que todo funciona en producción, el endpoint `api/courses/import/route.ts` de SofLIA puede eliminarse (es código obsoleto e inseguro según el plan original).