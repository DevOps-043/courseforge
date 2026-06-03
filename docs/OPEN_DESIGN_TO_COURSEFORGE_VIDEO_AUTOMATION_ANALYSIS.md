# Investigacion: Open Design -> Automatizacion de Produccion Visual y Video en Courseforge

## 1. Entendimiento del objetivo

Se investigo como adaptar ideas del repositorio local `D:\Pulse Hub\open-design` al flujo de produccion visual y video de Courseforge, tomando como base `docs/OPEN_DESIGN_VIDEO_RUNTIME_RESEARCH_BRIEF.md`, `prompt_maestro.md` y la arquitectura actual del proyecto.

El objetivo no es copiar Open Design ni asumir Remotion como nucleo. Open Design es un producto local-first con daemon local, agentes CLI, filesystem `.od` y preview sandboxed. Courseforge es una plataforma SaaS multi-tenant sobre Next.js, Netlify Functions y Supabase. Por eso, la investigacion se enfoca en extraer patrones transferibles y descartar piezas que dependen del entorno local.

## 2. Diagnostico ejecutivo

La conclusion principal es:

```text
Open Design no aporta un runtime de video SaaS listo para Courseforge.
Open Design aporta un modelo operativo: skills, design systems, preview seguro,
media dispatcher, jobs asincronos, validacion y export.
```

Remotion no debe tratarse como "core" solo porque aparece asociado a video. En Open Design, el renderer HTML-to-MP4 realmente integrado es `hyperframes-html`, ejecutado por el daemon mediante `npx hyperframes render`. Remotion aparece como compatibilidad o referencia conceptual en skills de video, no como el runtime principal del sistema.

Para Courseforge, la arquitectura correcta deberia ser un motor de produccion con:

- catalogo de proveedores y capacidades
- jobs asincronos persistidos en Supabase
- assets normalizados y versionados
- skills visuales versionados
- contratos de diseno por organizacion
- QA humana antes de publicar
- sincronizacion controlada hacia `material_components.assets` y `publication_requests.lesson_videos`

## 3. Fuentes locales revisadas

### Courseforge

- `prompt_maestro.md`
- `Produccion Visual y Video IA para CourseEngine _ Courseforge.md`
- `docs/OPEN_DESIGN_VIDEO_RUNTIME_RESEARCH_BRIEF.md`
- `docs/DOCUMENTACION_PASO_6_PRODUCCION_VISUAL.md`
- `apps/web/src/domains/materials/types/materials.types.ts`
- `apps/web/src/domains/materials/actions/production.actions.ts`
- `apps/web/src/domains/materials/components/VisualProductionContainer.tsx`
- `apps/web/src/domains/materials/components/ProductionAssetCard.tsx`
- `apps/web/src/domains/materials/hooks/useProductionAssetState.ts`
- `apps/web/netlify/functions/video-prompts-generation.ts`
- `apps/web/src/domains/publication/lib/publication-payload-builders.ts`
- `apps/web/src/app/api/storage/signed-upload-url/route.ts`
- `apps/web/src/lib/server/background-function-client.ts`
- `supabase/migrations/20260228120000_create_production_videos_bucket.sql`

### Open Design

- `D:\Pulse Hub\open-design\docs\architecture.md`
- `D:\Pulse Hub\open-design\docs\skills-protocol.md`
- `D:\Pulse Hub\open-design\docs\agent-adapters.md`
- `D:\Pulse Hub\open-design\specs\current\runtime-adapter.md`
- `D:\Pulse Hub\open-design\apps\daemon\src\media.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\media-models.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\media-routes.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\media-tasks.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\projects.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\skills.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\prompts\system.ts`
- `D:\Pulse Hub\open-design\apps\daemon\src\prompts\media-contract.ts`
- `D:\Pulse Hub\open-design\apps\web\src\artifacts\validate.ts`
- `D:\Pulse Hub\open-design\design-templates\hyperframes\SKILL.md`
- `D:\Pulse Hub\open-design\design-templates\video-shortform\SKILL.md`
- `D:\Pulse Hub\open-design\design-templates\html-ppt-course-module\SKILL.md`
- `D:\Pulse Hub\open-design\design-templates\html-ppt\SKILL.md`
- `D:\Pulse Hub\open-design\skills\video-hyperframes\SKILL.md`

## 4. Hallazgos clave de Open Design

### 4.1 Runtime real

Open Design funciona alrededor de un daemon local Node que:

- escucha en localhost
- compone prompts con skills, design systems y referencias craft
- ejecuta CLIs de agentes locales
- guarda artefactos en el filesystem local
- renderiza previews en iframes sandboxed
- despacha media con una interfaz uniforme
- ejecuta renders locales cuando el provider lo requiere

Esta forma de operar no debe copiarse en Courseforge porque:

- depende de binarios locales del usuario
- hereda permisos del ambiente local
- usa carpetas como fuente de verdad
- asume BYOK/local-first
- no resuelve multi-tenancy SaaS
- no encaja naturalmente con Netlify serverless

### 4.2 Media dispatcher

Open Design separa:

- catalogo de providers/modelos
- validacion de surface/model
- resolucion de aliases
- ejecucion por provider
- tareas asincronas
- persistencia de progreso
- archivo final generado

Este patron si es transferible. Courseforge deberia tener una capa parecida, pero respaldada por Supabase y servicios internos, no por daemon local.

### 4.3 Jobs asincronos

Open Design crea tareas para renders largos y permite esperar progreso. El patron es correcto para video porque los renders y llamadas a providers externos no deben vivir dentro de una request normal.

Courseforge ya usa Netlify Functions para background jobs, pero Fase 6 todavia no tiene una entidad robusta de `production_jobs`. Actualmente se guardan URLs y assets directamente en `material_components.assets`.

### 4.4 Skills y design systems

El modelo `SKILL.md` / `DESIGN.md` es una de las partes mas valiosas. No hay que importar archivos arbitrarios al filesystem de produccion, pero si conviene modelar:

- `visual_skills`
- `organization_design_systems`
- snapshots de skill y diseno usados en cada generacion
- compatibilidad por componente o salida
- versionado
- QA y validacion por tipo de salida

### 4.5 Preview seguro

Open Design usa iframe sandboxed sin `allow-same-origin`. Ese patron es adecuado para Courseforge si se acompana con:

- sanitizacion HTML
- CSP restrictiva
- bloqueo de URLs externas no permitidas
- validadores contra placeholders
- almacenamiento por organizacion
- QA antes de exportar/publicar

### 4.6 HyperFrames

El flujo `hyperframes-html` permite convertir HTML/GSAP en MP4. Es util como referencia para videos educativos animados, pero no deberia correr dentro de una request serverless comun.

Si Courseforge adopta HyperFrames o Remotion, debe ejecutarlos en un worker dedicado o entorno de render controlado con Node, Chromium/FFmpeg, limites de memoria, timeout, observabilidad y storage.

## 5. Estado actual de Courseforge en Fase 6

Courseforge ya tiene una Fase 6 parcial:

- UI para componentes `VIDEO_*` y `DEMO_GUIDE`
- generacion de B-roll prompts con Gemini
- creacion manual de Gamma
- captura de `slides_url`
- subida o pegado de `final_video_url`
- deteccion parcial de metadata de video
- sincronizacion hacia `publication_requests.lesson_videos`
- bucket `production-videos`

El estado actual es funcional para operacion asistida, pero tiene limites para automatizacion:

- `material_components.assets` concentra demasiadas responsabilidades
- no hay tabla normalizada de jobs de produccion
- no hay catalogo interno de providers
- no hay trazabilidad completa por intento/render/provider
- no hay webhook/event store para providers externos
- no hay idempotencia formal para evitar renders duplicados
- no hay control de costo por organizacion
- no hay QA automatica fuerte para outputs visuales o videos
- el flujo de publicacion depende del video final ya presente como URL

## 6. Piezas transferibles vs no transferibles

### Transferibles como patron

| Patron de Open Design | Adaptacion Courseforge |
| --- | --- |
| `SKILL.md` | `visual_skills` versionados en DB |
| `DESIGN.md` | `organization_design_systems` por tenant |
| media dispatcher | `production_provider_registry` + servicios por provider |
| media tasks | `production_jobs` con progreso, reintentos y auditoria |
| iframe sandboxed | preview HTML seguro en admin QA |
| artifact validation | validadores por tipo de output |
| provider catalog | catalogo de capacidades por provider/modelo |
| HyperFrames renderer | opcion de worker HTML-to-MP4, no runtime base |
| media contract | contrato interno para generar/wait/approve/export |

### No transferibles directamente

| Pieza de Open Design | Motivo |
| --- | --- |
| daemon local | no encaja con SaaS multi-tenant |
| agentes CLI en PATH | riesgo de seguridad y operacion |
| filesystem `.od` | Supabase debe ser fuente de verdad |
| BYOK local sin vault | Courseforge requiere credenciales seguras por tenant |
| `npx hyperframes render` en request | render pesado, dependiente de Chromium |
| skills desde rutas arbitrarias | falta revision, firma y control de permisos |
| heredar permisos del usuario local | incompatible con least privilege SaaS |

## 7. Arquitectura recomendada para Courseforge

### 7.1 Principio base

Courseforge debe tratar produccion visual y video como un dominio propio:

```text
materials aprobados -> production jobs -> production assets -> QA -> publication mapping
```

`material_components.assets` debe mantenerse como cache/compatibilidad del flujo actual, no como unica fuente de verdad para automatizacion.

### 7.2 Modulos sugeridos

```text
apps/web/src/domains/production/
  providers/
    production-provider.types.ts
    production-provider-registry.ts
    gamma.provider.ts
    heygen.provider.ts
    manual-upload.provider.ts
    html-video.provider.ts
  jobs/
    production-jobs.service.ts
    production-jobs.repository.ts
    production-job-status.ts
    production-job-idempotency.ts
  assets/
    production-assets.service.ts
    production-assets.repository.ts
    production-asset-sync.service.ts
  skills/
    visual-skills.service.ts
    visual-skill-prompt-composer.ts
  design-systems/
    organization-design-systems.service.ts
  validation/
    visual-artifact.validators.ts
    video-output.validators.ts
    provider-webhook.validators.ts
  qa/
    production-qa.service.ts
```

Netlify/background functions o routes sugeridas:

```text
production-job-create
production-job-run
production-provider-webhook
production-job-retry
visual-artifact-generate
visual-artifact-export
video-prompts-generation
```

### 7.3 Tablas recomendadas

#### `production_jobs`

Entidad central para cualquier automatizacion.

Campos sugeridos:

```sql
id uuid primary key default gen_random_uuid(),
organization_id uuid not null,
artifact_id uuid not null,
material_lesson_id uuid,
material_component_id uuid,
lesson_id text,
module_id text,

job_type text not null,
provider text not null,
provider_model text,
status text not null,

idempotency_key text not null,
attempt integer not null default 1,

input_snapshot jsonb not null default '{}',
output_snapshot jsonb not null default '{}',
progress jsonb not null default '[]',
provider_request_id text,
provider_job_id text,
provider_callback_id text,
provider_error jsonb,

estimated_cost_cents integer,
actual_cost_cents integer,
duration_seconds integer,

created_by uuid,
started_at timestamptz,
completed_at timestamptz,
failed_at timestamptz,
created_at timestamptz default now(),
updated_at timestamptz default now()
```

Indices importantes:

- `(organization_id, artifact_id)`
- `(organization_id, status)`
- `(material_component_id, job_type, status)`
- unique `(organization_id, idempotency_key)`
- `(provider, provider_job_id)` cuando exista

#### `production_assets`

Fuente normalizada de assets finales o intermedios.

Campos sugeridos:

```sql
id uuid primary key default gen_random_uuid(),
organization_id uuid not null,
artifact_id uuid not null,
production_job_id uuid references production_jobs(id),
material_lesson_id uuid,
material_component_id uuid,
lesson_id text,
module_id text,

asset_type text not null,
provider text,
storage_bucket text,
storage_path text,
public_url text,
external_url text,
mime_type text,
file_size_bytes bigint,
duration_seconds integer,
checksum text,

qa_status text not null default 'PENDING',
qa_notes text,
metadata jsonb not null default '{}',

created_by uuid,
approved_by uuid,
approved_at timestamptz,
created_at timestamptz default now(),
updated_at timestamptz default now()
```

#### `visual_skills`

Versiona las instrucciones estilo Open Design.

```sql
id uuid primary key default gen_random_uuid(),
code text not null,
name text not null,
description text,
version integer not null default 1,
skill_md text not null,
output_type text not null,
compatible_component_types text[] not null default '{}',
requires_design_system boolean not null default true,
is_active boolean not null default true,
is_system boolean not null default true,
metadata jsonb not null default '{}',
created_at timestamptz default now(),
updated_at timestamptz default now(),
unique (code, version)
```

#### `organization_design_systems`

Contrato visual por organizacion.

```sql
id uuid primary key default gen_random_uuid(),
organization_id uuid not null,
name text not null,
version integer not null default 1,
design_md text not null,
tokens jsonb not null default '{}',
is_default boolean not null default false,
is_active boolean not null default true,
created_by uuid,
created_at timestamptz default now(),
updated_at timestamptz default now()
```

#### `visual_artifacts`

Salida HTML/deck/eguide/storyboard antes de export.

```sql
id uuid primary key default gen_random_uuid(),
organization_id uuid not null,
artifact_id uuid not null,
production_job_id uuid references production_jobs(id),
visual_skill_id uuid references visual_skills(id),
design_system_id uuid references organization_design_systems(id),
material_lesson_id uuid,
material_component_id uuid,
scope text not null,
output_type text not null,
status text not null,
html text,
sanitized_html text,
prompt_snapshot text,
skill_snapshot text,
design_snapshot text,
validation_status text not null default 'PENDING',
validation_errors jsonb not null default '[]',
qa_status text not null default 'PENDING',
qa_notes text,
metadata jsonb not null default '{}',
created_at timestamptz default now(),
updated_at timestamptz default now()
```

#### `provider_webhook_events`

Auditoria e idempotencia de callbacks.

```sql
id uuid primary key default gen_random_uuid(),
provider text not null,
event_id text,
signature_valid boolean not null default false,
payload jsonb not null,
raw_headers jsonb not null default '{}',
production_job_id uuid references production_jobs(id),
processed_at timestamptz,
processing_error text,
created_at timestamptz default now(),
unique (provider, event_id)
```

### 7.4 Estados recomendados

Para jobs:

```text
PENDING
QUEUED
RUNNING
WAITING_PROVIDER
SUCCEEDED
FAILED
CANCELLED
RETRY_SCHEDULED
```

Para assets/QA:

```text
PENDING
GENERATED
READY_FOR_QA
APPROVED
REJECTED
EXPORTED
PUBLISHED
ARCHIVED
```

Para mantener compatibilidad, `material_components.assets.production_status` puede seguir usando:

```text
PENDING
IN_PROGRESS
DECK_READY
EXPORTED
COMPLETED
```

Pero ese status deberia derivarse de jobs/assets, no operar como verdad unica.

## 8. Flujos propuestos

### 8.1 B-roll prompts automatizados

Estado actual:

```text
storyboard -> Gemini -> b_roll_prompts -> material_components.assets
```

Evolucion recomendada:

```text
storyboard aprobado
  -> production_job(job_type=BROLL_PROMPT_GENERATION)
  -> Gemini
  -> production_asset(asset_type=BROLL_PROMPTS)
  -> QA opcional
  -> mirror a material_components.assets.b_roll_prompts
```

Este es el primer flujo natural porque ya existe `video-prompts-generation.ts`.

### 8.2 Deck visual o e-guide

```text
material aprobado + visual_skill + design_system
  -> prompt composer
  -> modelo IA
  -> visual_artifact.html
  -> sanitizacion y validacion
  -> preview sandboxed
  -> QA humana
  -> export HTML/PDF/ZIP
  -> production_assets
```

Este flujo adopta la parte mas fuerte de Open Design sin depender del daemon.

### 8.3 Gamma como provider paralelo

Gamma debe mantenerse como provider, no como paso manual permanente.

```text
content snapshot
  -> production_job(job_type=DECK_GENERATION, provider=gamma)
  -> Gamma API
  -> provider_deck_id
  -> slides_url/export
  -> production_asset(asset_type=SLIDES)
  -> mirror a material_components.assets.slides_url/gamma_deck_id
```

Si la API de Gamma no cubre todo el flujo deseado, se mantiene fallback manual con provider `manual`.

### 8.4 HeyGen u otro avatar provider

```text
video script aprobado
  -> script normalization sin cambiar hechos
  -> production_job(job_type=AVATAR_VIDEO)
  -> provider submit
  -> webhook/poll
  -> descargar o referenciar video
  -> validar metadata, mime, duracion
  -> READY_FOR_QA
  -> APPROVED
  -> mirror final_video_url a material_components.assets
  -> sync publication_requests.lesson_videos
```

El webhook debe verificar firma, idempotencia y `callback_id`.

### 8.5 Render interno HTML-to-MP4

Si se decide usar Remotion o HyperFrames:

```text
approved script/storyboard + visual skill
  -> composition source
  -> production_job(job_type=HTML_VIDEO_RENDER)
  -> worker dedicado
  -> MP4 en storage
  -> metadata validation
  -> READY_FOR_QA
```

No se recomienda ejecutar Chromium/FFmpeg dentro de server actions ni funciones cortas. Requiere worker dedicado, queue y limites estrictos.

## 9. Comparativa de runtimes y providers

| Opcion | Ventajas | Desventajas | Encaje recomendado |
| --- | --- | --- | --- |
| Gamma | Ya existe en el flujo mental del equipo, bueno para decks rapidos | Puede ser menos controlable, dependencia externa | Mantener como provider de slides |
| HeyGen | Ideal para avatar/voz/script validado, API y webhooks | Costo, latencia, dependencia vendor | MVP de video final avatar |
| Kaiber/Jitter/Veo | Buenos para B-roll o motion creativo | Calidad variable, APIs/contratos distintos | Provider adicional tras registry |
| HyperFrames | Cercano a Open Design, HTML/GSAP, MP4 deterministicos | Requiere Chrome/Puppeteer, daemon/CLI no portable directo | Worker especializado, no MVP inicial |
| Remotion | React/TS, composiciones versionables, ecosistema video | Requiere Chromium/FFmpeg, render infra, templates propios | Buena opcion para render interno controlado |
| Browser capture | Simple para previews o export visual | Fragil para audio/video largo | Util para PDF/snapshots, no video final core |
| Manual upload/link | Ya soportado y flexible | No automatiza ni audita proveedor | Fallback necesario |

Recomendacion: iniciar con providers externos y normalizacion de jobs/assets. Dejar Remotion/HyperFrames como decision de fase posterior, cuando exista infraestructura de workers.

## 10. Seguridad y multi-tenancy

Reglas obligatorias:

- toda tabla nueva debe incluir `organization_id`
- todo acceso admin debe validar pertenencia/rol
- credentials de providers nunca llegan al cliente
- API keys por organizacion deben cifrarse o almacenarse en un vault/control server-only
- webhooks deben validar HMAC/firma cuando el provider lo permita
- callbacks deben usar `provider_callback_id` no adivinable
- descargas de URLs externas requieren proteccion SSRF
- storage paths deben incluir organization/artifact/job
- HTML generado debe sanitizarse antes de preview/export
- preview debe usar iframe sandbox sin `allow-same-origin`
- logs no deben incluir scripts completos, secrets ni datos sensibles
- reintentos deben ser idempotentes para no duplicar costo

Riesgos concretos del flujo actual:

- `signed-upload-url` permite buckets permitidos y evita `..`, pero para produccion automatizada conviene exigir paths por organizacion/usuario y metadata esperada.
- `final_video_url` acepta enlaces externos; antes de publicacion automatica conviene validar provider, metadata, duracion, disponibilidad y ownership.
- `video-prompts-generation.ts` parsea JSON de Gemini, pero la salida requiere validacion estructural mas fuerte si sera base de renders pagados.

## 11. Validaciones automaticas recomendadas

### Visual artifacts

- HTML parseable
- no placeholders tipo `TODO`, `lorem`, `insert image`
- no scripts remotos salvo allowlist
- no iframes externos salvo allowlist
- CSS y assets dentro de limites de tamano
- no links a dominios no aprobados
- incluye objetivo de aprendizaje
- no introduce claims no presentes en materiales/fuentes
- respeta idioma del curso
- responsive minimo
- contraste minimo cuando sea viable

### Video jobs

- script aprobado y versionado
- componente es `VIDEO_THEORETICAL`, `VIDEO_DEMO` o `VIDEO_GUIDE`
- duracion estimada dentro de limites
- provider/model permitido por organizacion
- presupuesto disponible
- idempotency key unica
- webhook firmado
- output MIME permitido
- duracion real valida
- video accesible desde storage o provider
- transcript/subtitulos presentes cuando el flujo los requiera

### Publicacion

- no publicar assets con `qa_status != APPROVED`
- no publicar videos sin URL y duracion
- no publicar assets de otra organizacion
- no publicar si el asset fue rechazado despues de mapearse
- sincronizar `publication_requests.lesson_videos` solo desde assets aprobados

## 12. Observabilidad minima

Cada job debe guardar:

- `correlation_id`
- `provider_request_id`
- `provider_job_id`
- `idempotency_key`
- timestamps por estado
- intentos
- errores normalizados
- costo estimado/real
- progreso visible para UI

Eventos recomendados en `pipeline_events`:

```text
PRODUCTION_JOB_CREATED
PRODUCTION_JOB_STARTED
PRODUCTION_PROVIDER_SUBMITTED
PRODUCTION_PROVIDER_CALLBACK_RECEIVED
PRODUCTION_JOB_SUCCEEDED
PRODUCTION_JOB_FAILED
PRODUCTION_ASSET_READY_FOR_QA
PRODUCTION_ASSET_APPROVED
PRODUCTION_ASSET_REJECTED
PRODUCTION_ASSET_SYNCED_TO_PUBLICATION
```

## 13. Plan incremental recomendado

### Fase 0 - Decision tecnica controlada

Decidir el primer provider automatizado:

- si se busca valor rapido en video final: HeyGen
- si se busca valor rapido en slides: Gamma
- si se busca control visual propio: visual artifact HTML

Tambien decidir si habra worker dedicado para render interno. Sin worker, no conviene empezar por Remotion/HyperFrames.

### Fase 1 - Foundation de dominio

Entregables:

- `production_jobs`
- `production_assets`
- provider registry
- estados y contratos TypeScript
- sync service hacia `material_components.assets`
- eventos en `pipeline_events`
- tests de idempotencia/autorizacion basicos

Objetivo: no cambiar la UX completa todavia, solo crear la columna vertebral.

### Fase 2 - Migrar B-roll prompts al modelo de jobs

Entregables:

- adaptar `video-prompts-generation` para crear/actualizar job
- guardar `BROLL_PROMPTS` como `production_asset`
- mantener mirror a JSONB actual
- validacion Zod de respuesta Gemini

Objetivo: automatizacion de bajo riesgo porque ya existe el flujo.

### Fase 3 - Provider externo MVP

Elegir uno:

- Gamma API para deck
- HeyGen para `VIDEO_THEORETICAL`

Entregables:

- provider adapter
- credentials server-only
- create job
- webhook/polling
- QA ready
- approval
- sync a publicacion

Objetivo: primer flujo end-to-end automatizado y auditable.

### Fase 4 - Visual skills propios

Entregables:

- `visual_skills`
- `organization_design_systems`
- prompt composer
- `visual_artifacts`
- preview sandboxed
- validation guard
- export HTML/PDF/ZIP

Objetivo: incorporar lo mejor de Open Design sin portar su daemon.

### Fase 5 - Render interno opcional

Solo despues de tener jobs/assets/proveedores:

- evaluar Remotion vs HyperFrames con pruebas reales de render
- crear worker dedicado
- guardar composiciones y MP4
- validar costos, tiempos, memoria y errores

Objetivo: producir motion/video controlado internamente cuando el valor supere el costo operativo.

## 14. Ventajas y desventajas del enfoque recomendado

### Ventajas

- respeta la arquitectura actual de Courseforge
- evita introducir un daemon local incompatible
- reduce riesgo de seguridad multi-tenant
- permite sumar providers gradualmente
- deja trazabilidad por organizacion, artefacto, componente y provider
- conserva compatibilidad con Fase 6 actual
- habilita QA humana y automatica
- prepara publicacion a SofLIA sin acoplarla a un proveedor

### Desventajas

- requiere nuevas tablas y servicios antes de automatizar renders complejos
- el primer MVP no tendra todo el glamour de un renderer interno
- hay que definir manejo de credenciales por tenant
- los providers externos introducen costo, latencia y webhooks
- Remotion/HyperFrames quedan bloqueados hasta resolver infraestructura worker

## 15. Decisiones que NO conviene tomar aun

No decidir todavia:

- "Remotion sera el core"
- "HyperFrames reemplazara Gamma"
- "HeyGen sera el unico proveedor de video"
- "material_components.assets seguira siendo la unica fuente de verdad"
- "Netlify Functions renderizara MP4 internamente"

Esas decisiones requieren pruebas de runtime, costos, limites de proveedor y estrategia de workers.

## 16. Recomendacion final

Proceder con un primer diseno tecnico centrado en el dominio `production`, no en un runtime especifico.

El primer corte deberia ser:

```text
1. production_jobs
2. production_assets
3. provider registry
4. mirror controlado a material_components.assets
5. B-roll prompts como job
6. un provider automatizado inicial: Gamma o HeyGen
```

Despues de eso, evaluar Remotion/HyperFrames con una prueba aislada:

```text
script/storyboard aprobado -> composicion -> worker -> MP4 -> storage -> QA
```

Asi Courseforge gana automatizacion real sin quedar atrapado en supuestos del runtime local de Open Design.

## 17. Preguntas para decidir la siguiente implementacion

Antes de escribir codigo, conviene responder:

1. El primer valor de negocio es automatizar slides, avatar video o B-roll?
2. Ya existe acceso/API key operativa para HeyGen, Gamma, Kaiber, Jitter o Veo?
3. El despliegue aceptara un worker dedicado para Chromium/FFmpeg?
4. Los videos deben almacenarse siempre en Supabase o se aceptan URLs externas aprobadas?
5. La organizacion necesita credenciales por tenant o una credencial global administrada?
6. Que asset debe bloquear publicacion: solo video final o tambien slides/e-guides?
7. Que nivel de QA automatica se exige antes de gastar creditos en un render?

## 18. Nota de alcance

Este documento no implementa cambios de codigo, migraciones ni endpoints. Es la investigacion tecnica previa para decidir el primer corte de implementacion con bajo riesgo y alta trazabilidad.
