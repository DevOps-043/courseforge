# Integracion de HeyGen API en Courseforge

Fecha de investigacion: 2026-07-28

## Resumen ejecutivo

Courseforge ya tiene la base correcta para incorporar HeyGen: los componentes de video guardan `assets.avatar_video`, existen `production_jobs` / `production_assets` para auditar proveedores, y la UI de Produccion Visual ya contempla una seccion de "Avatar Video" con importacion desde HeyGen. Sin embargo, la integracion actual es parcial: importa videos por `video_id` usando el endpoint legacy `v2/video_status`, no lista avatares privados, no crea renders desde scripts, no registra iteraciones de HeyGen como jobs auditables, no usa webhooks, y no modela la cuenta/avatares existentes como catalogo reusable.

La recomendacion es crear un modulo independiente de "HeyGen Studio" dentro del dominio de produccion, conectado pero desacoplado del pipeline. Este modulo permitiria sincronizar avatares existentes de la cuenta, generar pruebas por componente/leccion, comparar iteraciones, aprobar una generacion y promoverla a `material_components.assets.avatar_video`. Despues, el mismo proveedor se puede usar desde el flujo normal de Fase 6 para crear el talking head de los componentes `VIDEO_THEORETICAL`, `VIDEO_DEMO` y `VIDEO_GUIDE`.

HeyGen no solo sirve para generar avatars. Para Courseforge tambien puede cubrir: videos de avatar desde guion, lipsync sobre audio externo, video translation para localizacion de cursos, TTS/voices, templates/personalized videos en legacy v2 para variaciones masivas, realtime avatars para Lia o tutores conversacionales, y Video Agent para prototipado rapido de videos completos. El uso mas rentable y controlable para el pipeline actual es empezar con generacion de avatar video, importacion automatica, QA e iteraciones; luego evaluar traduccion/lipsync y realtime como capacidades separadas.

## Contexto actual de Courseforge

### Flujo funcional existente

- Fase 5 genera materiales; los componentes de video contienen `script` y `storyboard`.
- Fase 6 Produccion Visual gestiona assets por componente: voz, musica, slides, B-roll, screencast y avatar.
- Fase 7 usa Remotion para ensamblar slides, B-roll, audio y `avatarVideoUrl`.
- La publicacion a Soflia usa el `final_video_url` y sincroniza videos a `publication_requests.lesson_videos`.

### Archivos relevantes

- `apps/web/src/domains/materials/types/materials.types.ts`
  - `MaterialAssets` ya contiene `avatar_video`, `voice_audio`, `b_roll_clips`, `slides`, `final_video_url`, `production_status` y DoD.
  - `VideoContent` y `VideoScript` ya tienen `narration_text`, `duration_seconds`, `timecode_start`, `timecode_end`.
- `apps/web/src/domains/materials/hooks/useProductionAssetState.ts`
  - Ya existe `handleHeygenSync(videoId)` y polling contra `/api/production/import-external`.
  - Hoy importa un video finalizado, pero no crea videos.
- `apps/web/src/app/api/production/import-external/route.ts`
  - Usa `HEYGEN_API_KEY` si existe.
  - Consulta `https://api.heygen.com/v2/video_status/{videoId}`.
  - Descarga el MP4, lo sube a Supabase Storage `production-assets`, y actualiza `assets.avatar_video`.
- `apps/web/src/domains/production/jobs/production-jobs.service.ts`
  - Tiene idempotencia, contexto por componente, snapshots, errores y estados.
- `supabase/migrations/20260523143000_create_production_jobs_assets.sql`
  - `production_jobs` y `production_assets` son el lugar correcto para trazabilidad de proveedores como HeyGen.
- `apps/web/src/remotion/types.ts`
  - El contrato de ensamblado ya acepta `avatarVideoUrl`, audio, slides y B-roll.

### Brecha principal

La UI ya parece preparada para "traer" un video de HeyGen, pero la plataforma todavia no gobierna el ciclo completo:

1. Descubrir avatares existentes de la cuenta.
2. Elegir avatar/voice/engine por organizacion o curso.
3. Generar video desde el script del componente.
4. Registrar cada intento como job.
5. Escuchar webhook o hacer polling robusto.
6. Descargar a Supabase antes de que expire el enlace presignado.
7. Comparar iteraciones y aprobar una.
8. Promover la version aprobada al asset del componente y al ensamblado Remotion.

## Hallazgos de la API de HeyGen

### Estado de versiones

HeyGen indica que v3 es la plataforma activa para nuevas integraciones. v1/v2 siguen soportadas hasta el 31 de octubre de 2026, pero el roadmap y las funciones nuevas estan en v3. Por eso conviene migrar la importacion actual desde `v2/video_status` hacia `GET /v3/videos/{video_id}` y construir el modulo nuevo sobre v3.

Fuente: https://developers.heygen.com/more-legacy-api

### Autenticacion

La API directa usa `x-api-key` / `X-Api-Key`. La llave se obtiene desde el dashboard de HeyGen. Para automatizacion y backend, HeyGen recomienda API key porque se factura contra el balance API y ofrece mas control programatico que OAuth.

Fuente: https://developers.heygen.com/docs/pricing

### Avatares existentes

Para usar el avatar que ya tienen creado:

- Listar grupos: `GET /v3/avatars?ownership=private`
- Listar looks: `GET /v3/avatars/looks?ownership=private`
- Filtrar Digital Twin: `GET /v3/avatars/looks?avatar_type=digital_twin&ownership=private`
- El `id` del look es el `avatar_id` que se envia a la generacion de video.
- Cada look devuelve metadata util: `name`, `group_id`, previews, `default_voice_id`, `supported_api_engines`, dimensiones, `status` y errores.

Fuente: https://developers.heygen.com/reference/list-avatar-looks

### Voces

Las voces se listan con `GET /v3/voices`. Permite filtrar por `type=public|private`, engine, language, gender, limite y cursor. Para Courseforge conviene sincronizar voces privadas y voces publicas recomendadas en una tabla/cache interna, no pedirle al admin que copie `voice_id` manualmente.

Fuente: https://developers.heygen.com/reference/list-voices

### Generacion de avatar video

Endpoint principal: `POST /v3/videos`.

Capacidades relevantes:

- Crear video desde avatar HeyGen o imagen.
- Usar script de texto con `voice_id`.
- Usar audio pregrabado con `audio_url` o `audio_asset_id` para lip-sync.
- Resoluciones `720p`, `1080p`, `4k`.
- Aspect ratios `16:9` y `9:16`.
- `engine` `avatar_iv` o `avatar_v`; Avatar IV es default si se omite.
- `remove_background` y `output_format=webm` para transparencia si el avatar soporta matting.
- `background` por color, URL o asset.
- `caption` para subtitulos.
- `callback_url` y `callback_id` para estado asincrono.
- `voice_settings` con speed, pitch, volume y locale.

Fuente: https://developers.heygen.com/reference/create-video

Para Digital Twin, HeyGen recomienda encontrar el avatar con `GET /v3/avatars/looks?avatar_type=digital_twin&ownership=private`, revisar `supported_api_engines` si se quiere Avatar V, crear el video con `POST /v3/videos`, y consultar `GET /v3/videos/{video_id}` hasta `completed` o `failed`.

Fuente: https://developers.heygen.com/generate-avatar-video

### Estado y descarga

`GET /v3/videos/{video_id}` devuelve `status`, `video_url`, `thumbnail_url`, `gif_url`, `captioned_video_url`, `subtitle_url`, `duration`, `failure_code`, `failure_message` y `video_page_url`.

Los enlaces de descarga son presignados y pueden expirar. Courseforge debe descargar el archivo a Supabase Storage en cuanto reciba `completed`, y guardar tambien `video_page_url`, `thumbnail_url`, `gif_url` y `subtitle_url` como metadata.

Fuente: https://developers.heygen.com/reference/get-video

### Webhooks

HeyGen permite registrar endpoints con `POST /v3/webhooks/endpoints`. Eventos utiles:

- `avatar_video.success`
- `avatar_video.fail`
- `avatar_video_caption.success`
- `video_translate.success`
- `video_translate.fail`
- `video_agent.success`
- `video_agent.fail`
- `instant_avatar.success`
- `photo_avatar_generation.success`
- `live_avatar.success`

El evento `avatar_video.success` incluye `video_id`, URL presignada, GIF, pagina en HeyGen, share page, folder y `callback_id`. La recomendacion de HeyGen es verificar firma, procesar por `event_type`, guardar el archivo con rapidez y responder 2xx.

Fuente: https://developers.heygen.com/docs/webhook-events

### Assets

`POST /v3/assets` sube imagen, video, audio, PDF o SRT y devuelve `asset_id`, URL, mime type y tamano. Maximo documentado para upload simple: 32 MB; soporta `png`, `jpeg`, `mp4`, `webm`, `mp3`, `wav`, `pdf`, `srt`.

Para Courseforge esto habilita:

- Subir audio de voz generado fuera de HeyGen y usar `audio_asset_id`.
- Subir fondos, imagenes o videos para background.
- Subir SRT para traduccion/proofread.
- Reutilizar assets sin depender solo de URLs publicas.

Fuente: https://developers.heygen.com/reference/upload-asset

### Traduccion de video

`POST /v3/video-translations` traduce un video a uno o mas idiomas con voice cloning y lip-sync. Modos:

- `speed`: mas rapido.
- `precision`: mayor calidad de lip-sync.
- `translate_audio_only`: traducir solo audio y mantener video.
- `enable_caption`, SRT, idioma origen/destino, rango `start_time` / `end_time`.

Para Courseforge, esto puede convertir cursos publicados o videos finales a multiples idiomas sin rehacer produccion visual.

Fuente: https://developers.heygen.com/reference/create-video-translation

### Realtime avatars

`POST /v3/avatar-realtime` crea sesiones de baja latencia y devuelve `stream_id`. Modos:

- `tts`: avatar habla un texto fijo.
- `audio`: lip-sync desde audio existente.
- `text_stream`: se inicia con texto y se agregan deltas con `POST /v3/avatar-realtime/{stream_id}/text`.

Esto es mas relevante para Lia como tutor/avatar conversacional que para Fase 6 batch. Debe tratarse como producto aparte porque requiere HLS, sesiones, latencia, concurrencia y costo por uso interactivo.

Fuente: https://developers.heygen.com/reference/create-avatar-realtime-session

### Video Agent

`POST /v3/video-agents` permite generar un video completo desde prompt. El agente maneja script, avatar, escenas, composicion y render. Tiene modo `generate` y `chat`.

Para Courseforge puede servir como laboratorio/prototipo o para crear borradores rapidos, pero no deberia sustituir el pipeline instruccional porque Courseforge ya tiene objetivos, syllabus, fuentes, guion y QA por componente. Mejor integrarlo como "borrador asistido" o "comparador de creatividad", no como motor principal de cursos acreditables.

Fuente: https://developers.heygen.com/reference/create-video-agent-session

### Costos y limites

Segun pricing self-serve de HeyGen:

- Avatar IV/V Photo Avatar: USD 0.05/s en 720p/1080p; USD 0.0667/s en 4K.
- Avatar IV/V Digital Twin o Studio Avatar: USD 0.0667/s en 720p/1080p; USD 0.0833/s en 4K.
- Video Agent: USD 0.0333/s.
- Video Translation speed lip-sync: USD 0.0333/s.
- Video Translation precision lip-sync: USD 0.0667/s.
- Lipsync speed: USD 0.0333/s; precision: USD 0.0667/s.
- Starfish TTS: USD 0.000667/s.
- Creacion de Digital Twin o Photo Avatar: USD 1.00 por llamada.

Nota: la documentacion de pricing y help center cambia con frecuencia. Antes de produccion, validar el plan real de la cuenta, limites de concurrencia, duracion maxima y si Digital Twin creation API requiere Enterprise para su caso.

Fuente: https://developers.heygen.com/docs/pricing

## Potencial de HeyGen en Courseforge

### 1. Generacion automatica de talking head por componente

Uso mas directo. Para cada `VIDEO_THEORETICAL`, `VIDEO_DEMO` o `VIDEO_GUIDE`, Courseforge toma el `VideoScript.sections[].narration_text`, construye un script final, genera el video de avatar, guarda MP4 en Supabase y lo pasa a Remotion como `avatarVideoUrl`.

Valor:

- Reduce trabajo manual.
- Mantiene consistencia del instructor/avatar.
- Hace iterables las lecciones teoricas.
- Permite 16:9 para curso y 9:16 para clips/resumen.

### 2. Avatar catalog interno por organizacion

Sincronizar los avatares privados de la cuenta HeyGen y guardarlos como presets por organizacion:

- Avatar oficial SofLIA.
- Avatar alternativo por instructor.
- Idioma/voz por defecto.
- Motor permitido: Avatar IV o V.
- Formato: fondo transparente WebM, MP4 con fondo, 16:9 o 9:16.

Valor:

- Evita copiar IDs manualmente.
- Permite defaults por curso/instructor.
- Reduce errores de proveedor.

### 3. Iteraciones y QA

Un modulo aparte permitiria generar variantes del mismo guion:

- Engine Avatar IV vs Avatar V.
- Voice speed/pitch/locale.
- Fondo transparente vs fondo institucional.
- Expressiveness/motion prompt si aplica.
- Script corto vs script extendido.

Cada iteracion debe quedar en `production_jobs` y `production_assets` con input/output/costo/status. El admin aprueba una y la promueve al asset del componente.

### 4. Lipsync con audio controlado por Courseforge

Si Courseforge genera voz por ElevenLabs, Gemini TTS u otro proveedor, HeyGen puede recibir `audio_url` / `audio_asset_id` para animar el avatar con esa locucion. Esto separa calidad de voz de calidad visual.

Valor:

- Mantener voces existentes.
- Mayor control de pronunciacion.
- Posibilidad de corregir solo audio sin rehacer slides/B-roll.

### 5. Localizacion de cursos

Despues de ensamblar el video final, Video Translate puede generar versiones en otros idiomas con lip-sync/captions.

Valor:

- Multiplicar salida del curso.
- Crear paquetes multilingues para Soflia.
- Reusar materiales aprobados.

### 6. Realtime Lia avatar

HeyGen Realtime puede llevar a Lia a un modo visual sin esperar render completo. Encaja mejor con:

- Onboarding guiado.
- Tutor conversacional.
- Simulaciones role-play.
- Sesiones de practica donde Lia habla y responde.

No debe mezclarse en la primera version de Fase 6 porque requiere arquitectura de sesion, streaming HLS, timeout, control de concurrencia y costos por interaccion.

### 7. Video Agent como sandbox creativo

Puede generar borradores de estilo o comparativas rapidas desde el brief de una leccion. No reemplaza el pipeline con fuentes y QA, pero puede ayudar a explorar visuales, tono, pacing y estructura antes de hacer el render formal.

## Arquitectura recomendada

### Principio

Crear un modulo independiente `domains/heygen` o `domains/production/providers/heygen` con API propia y UI de laboratorio, pero integrado al pipeline por contratos existentes:

- Entrada: `material_component`, `VideoScript`, `StoryboardItem[]`, `organization_id`.
- Salida: `production_job`, `production_asset`, `MaterialAssets.avatar_video`.
- Promocion: copiar la iteracion aprobada al componente.

### Capas propuestas

1. Cliente HeyGen server-side
   - `apps/web/src/domains/production/providers/heygen/heygen.client.ts`
   - Encapsula `fetch`, auth, errores, idempotency keys, retries y rate limit.

2. Servicio de catalogo
   - `heygen-catalog.service.ts`
   - Sincroniza avatar groups, avatar looks y voices.
   - Filtra `ownership=private`.

3. Servicio de generacion
   - `heygen-video.service.ts`
   - Crea jobs `POST /v3/videos`.
   - Guarda `provider_job_id=video_id`.
   - Calcula costo estimado por duracion.

4. Servicio de importacion
   - `heygen-import.service.ts`
   - Consulta `GET /v3/videos/{video_id}`.
   - Descarga `video_url`.
   - Sube a `production-assets/heygen/{componentId}/{jobId}.mp4`.
   - Inserta `production_assets`.

5. Webhook route
   - `apps/web/src/app/api/webhooks/heygen/route.ts`
   - Verifica firma.
   - Busca job por `callback_id` o `provider_job_id`.
   - Completa/falla job.
   - Guarda asset e incrementa estado.

6. UI de laboratorio
   - Ruta sugerida: `/admin/heygen` o `/admin/assets/heygen`.
   - Subvistas:
     - Catalogo de avatares.
     - Presets por organizacion.
     - Generador por componente.
     - Historial de iteraciones.
     - Comparador y aprobacion.

7. Integracion en Produccion Visual
   - En `AvatarVideoSection`, cambiar "ID de HeyGen" por:
     - Seleccionar preset/avatar.
     - Generar desde guion.
     - Importar por `video_id` o URL como fallback.
     - Ver iteraciones.

### Modelo de datos sugerido

Usar `production_jobs` y `production_assets` como fuente de auditoria. Agregar tablas pequenas para catalogo/config:

```sql
create table heygen_workspace_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  api_key_secret_ref text not null,
  account_label text,
  default_callback_url text,
  webhook_endpoint_id text,
  webhook_secret_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table heygen_avatar_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  heygen_avatar_group_id text,
  heygen_avatar_look_id text not null,
  name text not null,
  avatar_type text,
  default_voice_id text,
  supported_api_engines jsonb default '[]',
  preview_image_url text,
  preview_video_url text,
  status text,
  is_default boolean default false,
  metadata jsonb default '{}',
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table heygen_voice_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  heygen_voice_id text not null,
  name text,
  language text,
  gender text,
  type text,
  preview_audio_url text,
  is_default boolean default false,
  metadata jsonb default '{}',
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Extender constantes:

```ts
PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO = "HEYGEN_AVATAR_VIDEO";
PRODUCTION_JOB_TYPES.HEYGEN_VIDEO_TRANSLATION = "HEYGEN_VIDEO_TRANSLATION";
PRODUCTION_JOB_TYPES.HEYGEN_LIPSYNC = "HEYGEN_LIPSYNC";

PRODUCTION_ASSET_TYPES.AVATAR_VIDEO = "AVATAR_VIDEO";
PRODUCTION_ASSET_TYPES.TRANSLATED_VIDEO = "TRANSLATED_VIDEO";
PRODUCTION_ASSET_TYPES.SUBTITLE = "SUBTITLE";

PRODUCTION_PROVIDERS.HEYGEN = "heygen";
```

Metadata recomendada en `production_jobs.input_snapshot`:

```json
{
  "component_id": "uuid",
  "script_hash": "sha256",
  "script_text": "...",
  "avatar_id": "heygen-look-id",
  "voice_id": "heygen-voice-id",
  "engine": "avatar_v",
  "resolution": "1080p",
  "aspect_ratio": "16:9",
  "output_format": "mp4",
  "background": { "type": "color", "value": "#FFFFFF" },
  "callback_id": "courseforge-job-id"
}
```

Metadata recomendada en `production_assets.metadata`:

```json
{
  "provider": "heygen",
  "video_id": "heygen-video-id",
  "video_page_url": "https://app.heygen.com/video/...",
  "thumbnail_url": "...",
  "gif_url": "...",
  "subtitle_url": "...",
  "engine": "avatar_v",
  "avatar_id": "...",
  "voice_id": "...",
  "iteration_number": 3,
  "promoted_to_component": true
}
```

## Flujo propuesto para el modulo independiente

### 1. Configuracion inicial

1. Agregar `HEYGEN_API_KEY` al entorno server-side.
2. Crear endpoint interno "Sync HeyGen".
3. Llamar:
   - `GET /v3/users/me` para validar cuenta/balance.
   - `GET /v3/avatars/looks?ownership=private`.
   - `GET /v3/voices?type=private`.
4. Guardar presets de avatar/voz por organizacion.
5. Marcar el avatar existente de la cuenta como default.

### 2. Generacion desde componente

1. Admin entra a Produccion Visual o modulo HeyGen.
2. Selecciona componente `VIDEO_*`.
3. El sistema construye script:
   - Concatenar `VideoScript.sections[].narration_text`.
   - Validar duracion estimada.
   - Opcional: normalizar pausas y pronunciacion.
4. Admin elige avatar, voz, engine, resolucion, aspect ratio.
5. Backend crea `production_job`.
6. Backend llama `POST /v3/videos` con `callback_url` y `callback_id`.
7. Job queda `WAITING_PROVIDER`.

### 3. Completion

Opcion preferida: webhook.

1. HeyGen envia `avatar_video.success`.
2. Courseforge verifica firma.
3. Courseforge descarga URL presignada.
4. Guarda MP4 en Supabase Storage.
5. Inserta `production_assets`.
6. Marca job `SUCCEEDED`.
7. Si `auto_promote=true`, actualiza `material_components.assets.avatar_video`; si no, deja la iteracion para QA.

Fallback: polling.

1. Worker/background job consulta `GET /v3/videos/{video_id}`.
2. Si `completed`, descarga y guarda.
3. Si `failed`, guarda `failure_code` y `failure_message`.

### 4. QA e iteraciones

Cada generacion se muestra como tarjeta:

- Preview thumbnail/GIF/video.
- Avatar/voz/engine.
- Duracion.
- Costo estimado/real.
- Estado.
- Notas QA.
- Botones: aprobar, rechazar, duplicar parametros, generar variante.

Al aprobar:

- `production_assets.qa_status = APPROVED`.
- Actualizar `material_components.assets.avatar_video`.
- Recalcular `production_status`.
- Marcar downstream dirty para ensamblado si ya habia final video.

## Integracion especifica con Fase 6 / assets

### Donde encaja

En `ProductionAssetCard`, `AvatarVideoSection` debe evolucionar de "subir/importar" a "generar/importar/aprobar":

- Local upload: mantener.
- Drive import: mantener.
- HeyGen import por `video_id`/URL: mantener como fallback.
- HeyGen generate: nuevo flujo primario.
- Iterations drawer: nuevo.

### Requisitos por tipo de componente

- `VIDEO_THEORETICAL`
  - Requiere avatar video.
  - Requiere slides/B-roll/prompts segun estrategia.
  - Mejor candidato para HeyGen.

- `VIDEO_DEMO`
  - Avatar opcional; puede preferirse screencast + voz.
  - HeyGen util para intro/outro o explicacion.

- `VIDEO_GUIDE`
  - Puede usar avatar + screencast.
  - HeyGen util en instrucciones y transiciones.

- `DEMO_GUIDE`
  - No necesariamente requiere avatar.
  - HeyGen solo si se quiere presentador visual.

### Ajuste recomendado en `resolveProductionStatus`

Actualmente `VIDEO_THEORETICAL` requiere `assets.avatar_video?.public_url`. Mantener esa regla. Para `VIDEO_DEMO` y `VIDEO_GUIDE`, hacer configurable por preset/plantilla:

- `requires_avatar: true|false`
- `requires_voice_audio: true|false`
- `allows_avatar_as_voice: true`

Esto evita bloquear demos que solo necesitan screencast.

## Plan de implementacion

### Fase 0 - Validacion de cuenta y decision de alcance

Duracion estimada: 1-2 dias.

- Confirmar plan HeyGen, balance API, concurrencia, duracion maxima y permisos.
- Confirmar si el avatar existente es Digital Twin, Photo Avatar o Studio/private look.
- Confirmar si quieren usar voz HeyGen, voz clonada, ElevenLabs existente o audio generado fuera.
- Definir calidad default: `1080p`, `16:9`, `avatar_v` si esta soportado; fallback `avatar_iv`.
- Definir si el primer MVP solo genera talking-head o tambien lipsync desde audio.

Entregable: matriz de configuracion por organizacion.

### Fase 1 - Cliente y catalogo HeyGen

Duracion estimada: 3-5 dias.

- Crear `heygen.client.ts`.
- Crear tipos Zod para respuestas usadas.
- Crear endpoint admin `POST /api/production/heygen/sync`.
- Crear tablas `heygen_avatar_presets` y `heygen_voice_presets`.
- UI minima para ver avatares/voices privados.
- Marcar default avatar/voice.

DoD:

- Se ven avatares existentes de la cuenta.
- Se guarda `avatar_id` correcto.
- Se detecta `supported_api_engines`.

### Fase 2 - Generacion de avatar video por componente

Duracion estimada: 5-8 dias.

- Agregar job type `HEYGEN_AVATAR_VIDEO`.
- Registrar provider `heygen`.
- Crear action/API `POST /api/production/heygen/videos`.
- Construir script desde `VideoScript.sections`.
- Crear `POST /v3/videos`.
- Guardar `provider_job_id = video_id`.
- Hacer polling inicial con `GET /v3/videos/{video_id}`.
- Descargar a Supabase Storage al completar.
- Insertar `production_assets`.
- Mostrar iteraciones en UI.

DoD:

- Desde un componente real se genera un avatar video.
- El archivo queda en Supabase.
- El componente puede usarlo como `assets.avatar_video`.
- Remotion preview lo consume.

### Fase 3 - Webhooks e idempotencia fuerte

Duracion estimada: 3-5 dias.

- Crear `/api/webhooks/heygen`.
- Registrar webhook en HeyGen para `avatar_video.success` y `avatar_video.fail`.
- Guardar secret de forma segura.
- Verificar firma.
- Usar `callback_id` con el `production_job.id`.
- Reintentos seguros si el download falla.
- Guardar eventos recibidos o metadata en `production_jobs.progress`.

DoD:

- No depende de polling manual.
- Un render completado se importa automaticamente.
- Fallos muestran `failure_message`.

### Fase 4 - Laboratorio de iteraciones

Duracion estimada: 5-10 dias.

- Crear vista `/admin/heygen` o subvista en Produccion.
- Listar jobs por artifact/component.
- Comparar iteraciones.
- Aprobar/rechazar assets.
- Duplicar parametros.
- Notas QA.
- Estimacion de costo antes de generar.

DoD:

- Admin puede hacer 3 variantes y promover una.
- Historial auditable queda en `production_assets`.

### Fase 5 - Capacidades extendidas

Duracion estimada: variable.

Prioridad sugerida:

1. Lipsync con audio externo.
2. Video translation para cursos aprobados.
3. Captions/subtitles importados a assets.
4. Realtime avatar para Lia.
5. Video Agent para prototipos.

## Cambios concretos recomendados

### Backend/API

- Reemplazar uso de `v2/video_status` por `GET /v3/videos/{video_id}` en importacion.
- Nuevo endpoint: `GET /api/production/heygen/avatars`.
- Nuevo endpoint: `GET /api/production/heygen/voices`.
- Nuevo endpoint: `POST /api/production/heygen/sync`.
- Nuevo endpoint: `POST /api/production/heygen/videos`.
- Nuevo endpoint: `GET /api/production/heygen/jobs/{jobId}`.
- Nuevo endpoint: `POST /api/webhooks/heygen`.

### Frontend

- En `AvatarVideoSection`:
  - selector de avatar preset.
  - selector de voz.
  - selector de engine/resolucion.
  - boton "Generar con HeyGen".
  - estado de job.
  - galeria de iteraciones.
  - accion "Usar esta version".

### Storage

Rutas sugeridas:

- `production-assets/heygen/{artifactId}/{componentId}/{jobId}.mp4`
- `production-assets/heygen/{artifactId}/{componentId}/{jobId}.webm`
- `production-assets/heygen/{artifactId}/{componentId}/{jobId}.srt`
- `production-assets/heygen/{artifactId}/{componentId}/{jobId}-thumb.jpg`
- `production-assets/heygen/{artifactId}/{componentId}/{jobId}.gif`

### Variables de entorno

```env
HEYGEN_API_KEY=
HEYGEN_WEBHOOK_SECRET=
HEYGEN_DEFAULT_RESOLUTION=1080p
HEYGEN_DEFAULT_ENGINE=avatar_v
HEYGEN_DEFAULT_ASPECT_RATIO=16:9
```

No exponer `HEYGEN_API_KEY` al cliente.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigacion |
| --- | --- | --- |
| API v2 legacy en import actual | Integracion nueva nace sobre endpoint con fecha de soporte limitada | Migrar a v3 desde el MVP |
| URLs presignadas expiran | Se pierde acceso al MP4 si no se copia a storage propio | Descargar inmediatamente en webhook/polling |
| Costos por iteracion | Variantes pueden consumir balance rapido | Estimacion previa, limites por org, confirmacion antes de generar |
| Concurrencia/rate limit | Jobs fallan o se atrasan | Cola con `WAITING_PROVIDER`, retries, respeto de `Retry-After` |
| Avatar V no soportado por look | Error de validacion | Revisar `supported_api_engines` y fallback a Avatar IV |
| Matting/transparencia no disponible | WebM/fondo transparente falla | Detectar soporte y ofrecer MP4 con fondo |
| Secret handling | Exposicion de API key | Solo server-side, secret refs, logs redacted |
| Derechos/consentimiento de avatar | Riesgo legal y reputacional | Solo sincronizar avatares privados aprobados; registrar consent/status |
| Mezclar realtime con pipeline batch | Complejidad prematura | Tratar realtime como producto separado posterior |

## Decision recomendada

Implementar primero un MVP de "HeyGen Avatar Video" con v3:

1. Sincronizar avatares/voices existentes de la cuenta.
2. Generar videos de avatar desde scripts de componentes.
3. Guardar cada intento como `production_job` y `production_asset`.
4. Descargar resultados a Supabase Storage.
5. Permitir QA e iteraciones.
6. Promover una version a `assets.avatar_video`.
7. Mantener el ensamblado final en Remotion.

No recomiendo empezar con Video Agent ni Realtime como nucleo del pipeline. Son potentes, pero Courseforge ya tiene una arquitectura instruccional fuerte; HeyGen debe entrar primero como proveedor de assets gobernado, no como reemplazo del pipeline.

## Fuentes

- HeyGen API v3 / legacy support: https://developers.heygen.com/more-legacy-api
- List Avatar Looks: https://developers.heygen.com/reference/list-avatar-looks
- List Voices: https://developers.heygen.com/reference/list-voices
- Create Video: https://developers.heygen.com/reference/create-video
- Digital Twin video guide: https://developers.heygen.com/generate-avatar-video
- Get Video: https://developers.heygen.com/reference/get-video
- Webhook Events: https://developers.heygen.com/docs/webhook-events
- Create Webhook Endpoint: https://developers.heygen.com/reference/create-webhook-endpoint
- Upload Asset: https://developers.heygen.com/reference/upload-asset
- Video Translation: https://developers.heygen.com/reference/create-video-translation
- Avatar Realtime: https://developers.heygen.com/reference/create-avatar-realtime-session
- Video Agent: https://developers.heygen.com/reference/create-video-agent-session
- Pricing: https://developers.heygen.com/docs/pricing
