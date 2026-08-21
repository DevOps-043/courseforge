# Courseforge — Arquitectura asíncrona para renders de HeyGen

## Objetivo

Este documento describe la arquitectura recomendada para resolver el problema actual de Courseforge con la generación e importación de videos desde HeyGen.

El problema principal es que el seguimiento del render depende actualmente de una sesión activa del frontend o de una función temporal. Si el usuario recarga la página, cierra el editor o la función serverless termina por timeout, Courseforge deja de consultar el render, aunque HeyGen continúe procesándolo y termine correctamente.

La solución recomendada es desacoplar completamente el render de la sesión del navegador y de cualquier función de larga duración.

---

# 1. Problema actual

Actualmente el flujo es aproximadamente:

```text
Editor Courseforge
     |
     | Generar video
     v
Netlify Function
     |
     | POST HeyGen
     v
HeyGen genera video
     |
     | Courseforge consulta estado
     | 30% → 65% → ...
     |
     X usuario cierra / recarga página
     |
se pierde el seguimiento
```

El problema conceptual es que:

> El estado del proceso vive en la sesión del frontend o en una función temporal.

Cuando el navegador desaparece o la función termina, el sistema deja de hacer polling.

HeyGen puede continuar renderizando y terminar correctamente, pero Courseforge nunca importa el MP4 terminado.

Esto explica el incidente reciente en el que el ensamble terminó alrededor de las 11:45 a. m. CDMX, pero Courseforge dejó de consultarlo cuando estaba aproximadamente al 65%.

---

# 2. Por qué Netlify no es adecuado para esperar el render

Netlify Background Functions tienen un límite máximo de ejecución de 15 minutos.

Las funciones síncronas tienen límites todavía más cortos.

Esto es incompatible con renders de HeyGen que pueden tardar:

- 15 minutos
- 20 minutos
- 30 minutos
- 40 minutos
- más tiempo dependiendo del contenido

Documentación:

https://docs.netlify.com/build/functions/background-functions/

Por lo tanto, Netlify no debe utilizarse para mantener un proceso esperando a que HeyGen termine.

---

# 3. Supabase Edge Functions tampoco deben esperar

Mover el mismo `while` o proceso de polling largo a Supabase Edge Functions no resolvería el problema.

Las Supabase Edge Functions alojadas tienen límites de ejecución.

Actualmente, de acuerdo con la documentación oficial:

- Free: alrededor de 150 segundos de wall-clock
- Planes de pago: hasta aproximadamente 400 segundos de wall-clock

Incluso usando:

```javascript
EdgeRuntime.waitUntil(...)
```

la función continúa estando limitada por el tiempo máximo permitido.

Documentación:

https://supabase.com/docs/guides/functions/limits

Por lo tanto:

> Ninguna función debe permanecer esperando a que HeyGen termine.

---

# 4. Arquitectura recomendada

La solución debe ser completamente asíncrona.

```text
                      ┌───────────────────┐
                      │    FRONTEND       │
                      │     Netlify       │
                      └─────────┬─────────┘
                                │
                         "Generar video"
                                │
                                ▼
                  ┌────────────────────────┐
                  │ Supabase Edge Function│
                  │     create-render      │
                  └───────────┬────────────┘
                              │
                 1. crea registro en DB
                 2. solicita video
                              │
                              ▼
                       ┌────────────┐
                       │   HeyGen   │
                       └─────┬──────┘
                             │
                    devuelve video_id
                             │
                             ▼
                  ┌──────────────────────┐
                  │      Supabase DB     │
                  │                      │
                  │ status=processing    │
                  │ heygen_video_id=XYZ  │
                  └──────────────────────┘

                        ...20 minutos...
                        ...40 minutos...
                        ...usuario cerró...
                        ...PC apagada...

                             │
                             │ WEBHOOK
                             ▼
               ┌──────────────────────────┐
               │ Supabase Edge Function  │
               │     heygen-webhook       │
               └───────────┬──────────────┘
                           │
                    avatar_video.success
                           │
                           ▼
                  descargar / almacenar MP4
                           │
                           ▼
                   ┌───────────────────┐
                   │   Supabase DB     │
                   │ status=completed  │
                   │ video_url=...     │
                   └─────────┬─────────┘
                             │
                       Supabase Realtime
                             │
                             ▼
                    ┌────────────────┐
                    │   Courseforge  │
                    │ actualiza UI   │
                    └────────────────┘
```

---

# 5. Principio principal

La regla central debe ser:

```text
Nunca esperar el resultado de HeyGen.

Solicitar → Persistir → Responder.

Después:

Webhook → Persistir → Importar → Publicar.
```

Esto permite que el usuario pueda:

- cerrar Courseforge
- cerrar la pestaña
- recargar el navegador
- apagar la computadora
- perder temporalmente conexión

sin afectar el render.

---

# 6. HeyGen Webhooks

HeyGen soporta un modelo asíncrono basado en webhooks.

Al crear el video se puede indicar un endpoint de callback.

Conceptualmente:

```json
{
  "callback_url": "https://PROJECT.supabase.co/functions/v1/heygen-webhook",
  "callback_id": "courseforge_render_7821"
}
```

Documentación:

https://developers.heygen.com/reference/create-video

Eventos relevantes:

```text
avatar_video.success
avatar_video.fail
```

Documentación:

https://developers.heygen.com/docs/webhook-events

Cuando el video termina, HeyGen puede enviar información como:

```text
video_id
url
gif_download_url
video_page_url
video_share_page_url
folder_id
callback_id
```

El `callback_id` es muy útil para relacionar el callback con un render específico de Courseforge.

---

# 7. Tabla de trabajos de render

Se recomienda crear una tabla dedicada.

Nombre sugerido:

```text
video_render_jobs
```

Esquema conceptual:

```sql
create table video_render_jobs (
    id uuid primary key default gen_random_uuid(),

    course_id uuid,
    lesson_id uuid,
    content_id uuid,

    provider text not null default 'heygen',

    provider_job_id text,
    callback_id text unique,

    status text not null default 'queued',

    progress integer,

    provider_video_url text,
    storage_path text,
    published_video_url text,

    error_message text,

    created_at timestamptz default now(),
    started_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz default now()
);
```

---

# 8. Estados recomendados

Usar una máquina de estados clara.

```text
queued
submitted
processing
completed
importing
published
failed
```

Ejemplo:

```text
queued
  ↓
submitted
  ↓
processing
  ↓
completed
  ↓
importing
  ↓
published
```

En caso de error:

```text
processing
  ↓
failed
```

o:

```text
importing
  ↓
failed
```

---

# 9. Edge Function: create-render

Crear una Edge Function similar a:

```text
create-heygen-render
```

Responsabilidades:

```text
1. validar usuario
2. validar permisos
3. validar curso / lección / contenido
4. crear registro video_render_jobs
5. generar callback_id
6. solicitar render a HeyGen
7. obtener video_id
8. guardar video_id
9. cambiar estado a processing
10. responder al frontend
```

La función NO debe esperar a que el video termine.

Respuesta sugerida:

```json
{
  "job_id": "71c...",
  "status": "processing"
}
```

---

# 10. Antipatrón que debe eliminarse

No utilizar:

```javascript
while (true) {
  const status = await checkHeygen();

  if (status === "completed") {
    break;
  }

  await sleep(10000);
}
```

Tampoco mantener conexiones HTTP abiertas durante todo el render.

---

# 11. Edge Function: heygen-webhook

Crear una función pública controlada:

```text
heygen-webhook
```

Responsabilidades:

```text
1. recibir callback de HeyGen
2. validar autenticidad del webhook
3. leer event_type
4. localizar video_render_job
5. actualizar estado
6. guardar video_id y URL temporal
7. disparar importación
```

Flujo esperado:

```text
HeyGen
   │
   │ avatar_video.success
   ▼
heygen-webhook
   │
   ▼
video_render_jobs
status = completed
```

Ejemplo conceptual de payload:

```json
{
  "event_type": "avatar_video.success",
  "event_data": {
    "video_id": "abc987",
    "url": "https://...",
    "callback_id": "render_12345"
  }
}
```

---

# 12. Importación del MP4

La URL de HeyGen no debería utilizarse como URL final permanente.

Normalmente HeyGen entrega una URL temporal o prefirmada.

Por lo tanto se recomienda:

```text
HeyGen
   │
   │ URL MP4 temporal
   ▼
import-video
   │
   ▼
Supabase Storage
   │
   ▼
Courseforge
```

Ruta sugerida:

```text
courseforge-videos/
    course_123/
        lesson_47/
            render_7529.mp4
```

Documentación de Storage + Edge Functions:

https://supabase.com/docs/guides/functions/storage-caching

---

# 13. Estado después de importar

Una vez almacenado correctamente:

```sql
status = 'published'
```

y guardar:

```text
storage_path
published_video_url
completed_at
updated_at
```

Por ejemplo:

```text
courseforge-videos/course_123/lesson_47/render_7529.mp4
```

---

# 14. Supabase Realtime para actualizar el frontend

El frontend puede escuchar cambios en `video_render_jobs`.

Ejemplo:

```javascript
supabase
  .channel(`render:${renderId}`)
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'video_render_jobs',
      filter: `id=eq.${renderId}`
    },
    (payload) => {
      console.log(payload.new);
    }
  )
  .subscribe();
```

Documentación:

https://supabase.com/docs/guides/realtime/subscribing-to-database-changes

---

# 15. UI recomendada

Mientras procesa:

```text
🎬 Generando video...

HeyGen está procesando el video.

Puedes salir de esta página.
El proceso continuará en segundo plano.
```

Estados posibles:

```text
Preparando render...
Enviando a HeyGen...
Procesando video...
Video terminado.
Importando video...
Publicando video...
✓ Video listo
```

---

# 16. Qué ocurre si el usuario recarga

Al abrir nuevamente el editor:

```sql
select *
from video_render_jobs
where content_id = :content_id
order by created_at desc
limit 1;
```

Si devuelve:

```text
status = processing
```

mostrar:

```text
Video todavía en procesamiento
```

Si devuelve:

```text
status = published
```

cargar automáticamente el nuevo video.

No debe existir nada que recuperar del navegador.

La base de datos es la fuente de verdad.

---

# 17. Recuperación de renders huérfanos

Aunque el webhook sea el mecanismo principal, se recomienda una capa de reconciliación.

Arquitectura:

```text
Webhook = principal
Cron/Poll = recuperación
```

Supabase permite programar funciones mediante Cron.

Documentación:

https://supabase.com/docs/guides/functions/schedule-functions

---

# 18. Cron de reconciliación

Ejecutar por ejemplo cada 2 o 5 minutos.

Buscar renders pendientes:

```sql
select *
from video_render_jobs
where status in ('submitted', 'processing')
and updated_at < now() - interval '2 minutes';
```

Por cada uno:

```text
1. consultar estado en HeyGen
2. actualizar progress si existe
3. si completed → importar
4. si failed → marcar failed
5. finalizar ejecución
```

La función debe durar segundos, no minutos.

---

# 19. Recuperar renders que ya existen

Si Courseforge ya tiene un `video_id` de HeyGen, no necesariamente debe volver a generar el contenido.

Se puede consultar su estado.

Documentación:

https://developers.heygen.com/generate-avatar-video

Flujo:

```text
Courseforge DB
      │
      │ video_id
      ▼
HeyGen API
      │
      ├── completed
      │      ↓
      │  recuperar URL
      │      ↓
      │  importar MP4
      │
      ├── processing
      │
      └── failed
```

Esto permitiría recuperar renders actualmente huérfanos.

---

# 20. Acción administrativa recomendada

Agregar una acción interna:

```text
Reconciliar render
```

O:

```text
Recuperar video desde HeyGen
```

Debe:

```text
1. leer provider_job_id
2. consultar HeyGen
3. detectar estado real
4. actualizar DB
5. importar MP4 si está terminado
```

---

# 21. Supabase Queues

Para una arquitectura más robusta se puede utilizar Supabase Queues.

Supabase Queues utiliza PostgreSQL/pgmq para manejar mensajes persistentes.

Documentación:

https://supabase.com/docs/guides/queues/pgmq

Colas sugeridas:

```text
heygen_render_requests
heygen_video_imports
render_reconciliation
```

---

# 22. Cola para importar videos

Arquitectura:

```text
Webhook HeyGen
       │
       ▼
actualiza DB
       │
       ▼
queue: import_video
       │
       ▼
worker Edge Function
       │
       ▼
descarga MP4
       │
       ▼
Supabase Storage
       │
       ▼
status = published
```

Ventaja:

Si la descarga falla:

```text
NO se pierde el trabajo.
```

El mensaje puede volver a procesarse.

Documentación:

https://supabase.com/docs/guides/queues/consuming-messages-with-edge-functions

---

# 23. Arquitectura final recomendada

```text
                            COURSEFORGE
                         Frontend / Netlify
                               │
                ┌──────────────┴──────────────┐
                │                             │
          Crear render                  Consultar estado
                │                             │
                ▼                             ▼
       Supabase Edge Function          Supabase Database
          create-render                       │
                │                             │
                ▼                             │
              HeyGen                          │
                │                             │
                │ video_id                    │
                └──────────────► render_jobs ─┘
                                      │
                                      │
                   ┌──────────────────┘
                   │
                   │ minutos después
                   ▼
                HeyGen
                   │
                   │ WEBHOOK
                   ▼
        Supabase Edge Function
             heygen-webhook
                   │
                   ▼
             render_jobs
             completed
                   │
                   ▼
          Supabase Queue
              import_mp4
                   │
                   ▼
         Edge Function worker
                   │
             descarga MP4
                   │
                   ▼
          Supabase Storage
                   │
                   ▼
             render_jobs
              published
                   │
              Realtime
                   │
                   ▼
            COURSEFORGE
            video nuevo
```

---

# 24. Responsabilidad de Netlify

Netlify puede seguir utilizándose para:

```text
Frontend
React / Vue / Next / Vite
hosting
assets
deployments
CDN
```

Debe dejar de ser responsable de:

```text
esperar a HeyGen
gestionar renders largos
mantener polling persistente
guardar estado temporal del render
```

---

# 25. Responsabilidad de Supabase

Supabase manejaría:

```text
Database
Auth
Edge Functions cortas
Realtime
Queues
Cron
Storage
estado persistente
```

---

# 26. Responsabilidad de HeyGen

HeyGen manejaría:

```text
renderizado largo
procesamiento de video
notificación por webhook
entrega del MP4 temporal
```

---

# 27. Flujo completo propuesto

## Inicio

```text
Usuario pulsa "Generar video"
```

Frontend:

```text
POST /create-heygen-render
```

Supabase:

```text
crea job
envía HeyGen
guarda video_id
responde
```

Frontend:

```text
muestra "Procesando"
```

---

## Procesamiento

```text
HeyGen renderiza independientemente
```

No existe una conexión larga.

No importa si:

```text
usuario recarga
usuario cierra
usuario sale de Courseforge
PC se apaga
```

---

## Finalización

HeyGen:

```text
POST /heygen-webhook
```

Supabase:

```text
status = completed
```

Después:

```text
importar MP4
```

Después:

```text
status = published
```

Realtime:

```text
notifica frontend
```

Frontend:

```text
muestra video nuevo
```

---

# 28. Ejemplo con el incidente real

Con esta arquitectura:

```text
11:20
Courseforge solicita render
```

```text
11:20
DB:
status = processing
```

El usuario cierra el editor.

HeyGen continúa.

```text
11:45
HeyGen termina
```

HeyGen:

```text
POST webhook
```

Supabase:

```text
status = completed
```

Importador:

```text
descarga MP4
sube a Storage
```

Supabase:

```text
status = published
```

Cuando el usuario abre Courseforge a las 13:00:

```text
Courseforge consulta DB
```

Respuesta:

```text
status = published
```

El nuevo video aparece automáticamente.

---

# 29. Seguridad del webhook

El endpoint de webhook debe validar que la llamada realmente proviene de HeyGen.

Revisar la documentación actual de HeyGen para:

```text
firma del webhook
secret
headers
verificación
```

No confiar solamente en:

```text
callback_id
```

También deben protegerse:

```text
service_role key
variables de entorno
tokens de HeyGen
```

Nunca enviar secretos al frontend.

---

# 30. Idempotencia

El webhook debe ser idempotente.

HeyGen podría eventualmente reenviar un evento.

Por lo tanto:

```text
avatar_video.success
```

recibido dos veces no debe provocar dos publicaciones o dos imports.

Ejemplo:

```sql
if status = 'published'
then
    return success
end if;
```

También puede usarse:

```text
provider_job_id UNIQUE
callback_id UNIQUE
```

---

# 31. Reintentos

Agregar campos opcionales:

```sql
retry_count integer default 0,
last_retry_at timestamptz,
next_retry_at timestamptz
```

Estados adicionales posibles:

```text
import_failed
retrying
```

---

# 32. Observabilidad

Agregar logs útiles.

Por render:

```text
render_id
provider_job_id
course_id
content_id
status
timestamps
last_error
```

También puede crearse:

```text
video_render_job_events
```

Ejemplo:

```sql
id
render_job_id
event
metadata
created_at
```

Eventos:

```text
render_created
heygen_submitted
heygen_processing
heygen_completed
import_started
import_completed
published
failed
retry_started
```

Esto facilitará muchísimo investigar incidentes.

---

# 33. Checklist de implementación

## Base de datos

- [ ] Crear tabla `video_render_jobs`
- [ ] Agregar índices
- [ ] Agregar `callback_id UNIQUE`
- [ ] Agregar `provider_job_id`
- [ ] Definir estados
- [ ] Configurar RLS

## Edge Functions

- [ ] Crear `create-heygen-render`
- [ ] Crear `heygen-webhook`
- [ ] Crear `import-heygen-video`
- [ ] Crear `reconcile-heygen-renders`

## HeyGen

- [ ] Configurar webhook
- [ ] Generar `callback_id`
- [ ] Guardar `video_id`
- [ ] Implementar verificación del webhook
- [ ] Manejar success
- [ ] Manejar fail

## Storage

- [ ] Crear bucket de videos
- [ ] Definir estructura de rutas
- [ ] Configurar políticas
- [ ] Subir MP4 terminado
- [ ] Guardar `storage_path`

## Frontend

- [ ] Eliminar dependencia del polling local persistente
- [ ] Consultar job al cargar editor
- [ ] Suscribirse a Realtime
- [ ] Mostrar estado
- [ ] Permitir cerrar página
- [ ] Refrescar reproductor al publicar

## Recuperación

- [ ] Configurar Cron
- [ ] Buscar renders huérfanos
- [ ] Consultar HeyGen
- [ ] Recuperar videos completed
- [ ] Marcar errores

## Robustez

- [ ] Implementar idempotencia
- [ ] Implementar retries
- [ ] Registrar eventos
- [ ] Alertar renders estancados

---

# 34. Orden recomendado de implementación

## Fase 1

Implementar primero:

```text
video_render_jobs
create-heygen-render
heygen-webhook
Realtime
```

Esto resuelve el problema principal.

---

## Fase 2

Agregar:

```text
importación MP4 a Supabase Storage
```

---

## Fase 3

Agregar:

```text
Cron de reconciliación
```

Esto recupera renders cuyo webhook se haya perdido.

---

## Fase 4

Agregar:

```text
Queues
retries
observabilidad
alertas
```

Esto mejora la resiliencia para producción.

---

# 35. Decisión arquitectónica

No es necesario migrar todo Courseforge fuera de Netlify.

La arquitectura recomendada es:

```text
Netlify
    → frontend

Supabase
    → DB
    → Auth
    → Edge Functions cortas
    → Realtime
    → Queues
    → Cron
    → Storage

HeyGen
    → renderizado largo
    → webhook
```

---

# 36. Conclusión

El problema no se resuelve buscando una función serverless que pueda esperar más tiempo.

Se resuelve eliminando la necesidad de esperar.

La arquitectura correcta es:

```text
Solicitar render
        ↓
Persistir job
        ↓
Responder al navegador
        ↓
HeyGen procesa independientemente
        ↓
Webhook
        ↓
Actualizar DB
        ↓
Importar MP4
        ↓
Storage
        ↓
Publicar
        ↓
Realtime
        ↓
Actualizar Courseforge
```

Con esta arquitectura, cerrar o recargar Courseforge deja de afectar el proceso de generación.

El render de HeyGen pasa a ser un trabajo persistente del backend y no una operación dependiente de la sesión del usuario.
