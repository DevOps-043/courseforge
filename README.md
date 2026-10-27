# SofLIA - Engine

> Plataforma multi-tenant de ingenieria instruccional con IA.

El [arnés de desarrollo](docs/architecture/development-harness.md) organiza el
trabajo asistido por agentes. Lee [AGENTS.md](AGENTS.md), la
[guía operativa](docs/operations/harness-quickstart.md) y el
[contexto canónico](docs/architecture/system-context.md). Las instrucciones por
herramienta apuntan a esas fuentes; el estado de cambios vive en OpenSpec.

SofLIA - Engine crea cursos completos a partir de una idea o de un paquete SCORM: investiga, estructura, planifica, cura fuentes, genera materiales, produce assets visuales, ensambla videos con Remotion y publica el resultado hacia SofLIA.

El producto es un flujo operativo con aprobaciones humanas, contratos de datos versionados, configuracion por organizacion, importacion de assets externos, monitoreo de consumo de IA y una capa de produccion audiovisual (editor de composicion, HeyGen, slides, efectos de sonido y procesamiento de audio).

El código incorpora autoría sincrónica e híbrida bajo habilitación explícita, desactivada por defecto: agenda, plan y materiales por sesión dentro de las ocho etapas, con modelos/prompts configurables y entrega HTML imprimible desde Engine. Requiere migración y piloto autorizado; no se presenta como capacidad ya desplegada. Ver [operación y límites](docs/operations/synchronous-hybrid-courses.md).

## Tabla De Contenidos

La identidad de presentación se configura en `apps/web/src/config/app.ts`, sin variables de entorno. El nombre nuevo aún está pendiente; la integración externa SofLIA y los identificadores técnicos mantienen compatibilidad. Ver [identidad global y procedimiento de cambio](docs/architecture/product-branding.md).

1. [Stack](#stack)
2. [Estructura Del Repo](#estructura-del-repo)
3. [Como Correrlo](#como-correrlo)
4. [Arquitectura Actual](#arquitectura-actual)
5. [Pipeline Educativo](#pipeline-educativo)
6. [Produccion Audiovisual](#produccion-audiovisual)
7. [Auth, Tenancy y Publicacion](#auth-tenancy-y-publicacion)
8. [Consola De Plataforma y Consumo De IA](#consola-de-plataforma-y-consumo-de-ia)
9. [APIs y Jobs](#apis-y-jobs)
10. [Datos y Storage](#datos-y-storage)
11. [Variables De Entorno](#variables-de-entorno)
12. [Validacion](#validacion)
13. [Reglas De Mantenimiento](#reglas-de-mantenimiento)

---

## Stack

La voz de catalogo HeyGen usa Starfish explicitamente tanto al listar voces como al sintetizar audio; no depende del motor guardado en HeyGen. Diagnostico y validacion del incidente `locale`: [auditoria de voz](docs/architecture/heygen-speech-engine-audit-2026-10-13.md).

La sincronizacion del catalogo HeyGen requiere la cadena completa de funciones SQL de reconciliacion. Para el fallo `42883` por dependencia ausente, ver [contrato y reparacion](docs/heygen_catalog_sync_source_of_truth.md).

| Capa | Tecnologia |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript |
| UI | TailwindCSS 4, Framer Motion, lucide-react, Sonner |
| Estado | Zustand |
| Backend web | Next.js API routes + Netlify Functions (background y programadas) |
| Worker de audio | `apps/api` (Node 20 + FFmpeg; perfil neural opcional con DeepFilterNet) |
| DB/Auth | Supabase PostgreSQL, RLS, Auth Bridge JWT HS256 |
| IA | Google Gemini principal, OpenAI fallback/curacion/bundle agent |
| Video | Editor de composicion nativo + HyperFrames Cloud para render; Remotion 4.0.484 (Player y composiciones internas) |
| Integraciones | SofLIA API, PulseHub, HeyGen, HyperFrames Cloud, Google Search, Google Drive, Microsoft Graph, Artlist |

---

## Estructura Del Repo

```text
apps/
  web/
    src/app/                 App Router, dashboards, API routes
    src/domains/             Logica de negocio por dominio
    src/remotion/            Composiciones internas Remotion
    netlify/functions/       Jobs background y programados
  api/
    src/server.ts            Express legado (solo /health)
    src/features/auth/       Auth auxiliar legado
    src/features/audio-processing/  Worker de procesamiento de audio
    native/rnnoise/          Fuente C del adaptador RNNoise
    third_party/             Manifiestos de artefactos DeepFilterNet/RNNoise
    Dockerfile.audio-worker[-neural]
supabase/
  migrations/
  Scripts/
docs/
licenses/
reportes/
scripts/
```

Dominios en `apps/web/src/domains`:

- `admin-dashboard`
- `artifacts`
- `syllabus`
- `plan`
- `curation`
- `materials`
- `production`
- `publication`
- `scorm`
- `prompts`
- `video-duration`

Subdominios de `production`: `animated-deck`, `assembly-branding`, `assets`, `audio-processing`, `automation`, `bundle-agent`, `cloud-storage`, `composition-editor`, `course-context`, `fonts`, `hyperframes`, `jobs`, `providers` (HeyGen), `render-batches`, `slides`, `sound-effects`, `standalone`, `templates`, `text` y `validation`.

---

## Como Correrlo

```bash
npm install
npm run dev
```

`npm run dev` levanta `apps/web` (Next.js en `http://localhost:3000`).

Comandos utiles:

```bash
npm run build
npm run lint
npm run typecheck
npm run verify
npm run db:migrations:check
npm run docs:audit
npm run compliance:verify
npm run dev:legacy-api
npm run start:audio-worker --workspace=apps/api
```

`npm run verify` ejecuta lint, TypeScript, deteccion de ciclos (`madge`), chequeo de versiones de migraciones, pruebas de fronteras de seguridad, pruebas de procesamiento de audio y pruebas de gaps de cobertura.

---

## Arquitectura Actual

SofLIA - Engine funciona desde `apps/web`:

1. **`apps/web`**: interfaz, dashboards, API routes, Auth Bridge, pipeline educativo, importaciones, editor de composicion, integraciones HeyGen/HyperFrames, publicacion y consola de plataforma.
2. **`apps/api`**: worker de procesamiento de audio (`start:audio-worker`) y un servidor Express legado que hoy solo expone `GET /health`. Los endpoints Express de render Remotion local/Lambda y builds cloud ya no existen en el codigo.

La regla en `apps/web/src/domains` es crear carpetas por capacidad solo cuando hacen falta: `actions`, `components`, `config`, `hooks`, `lib`, `services`, `types` y `validators`.

Los jobs largos se ejecutan como Netlify Background Functions firmadas con `BACKGROUND_FUNCTION_SECRET` y nonces de un solo uso (`background_request_nonces`). Las generaciones de syllabus, curacion y materiales hacen commits atomicos mediante RPCs (`start_/claim_/commit_/reset_material_generation`, `commit_curation_progress`) y tienen logica de recuperacion de corridas atascadas.

---

## Pipeline Educativo

### Fase 1: BASE

Convierte la idea inicial en una ficha de curso con objetivos y nombres sugeridos.

Job: `apps/web/netlify/functions/generate-artifact-background.ts`

Salida principal:

- `objetivos[]`
- `nombres[]`
- `generation_metadata`
- estado `GENERATING` -> `STEP_APPROVED`

### Fase 2: SYLLABUS

Genera la estructura de modulos y lecciones, valida rangos, aplica la politica de duracion del curso y decide si requiere fuentes externas (`A_WITH_SOURCE` / `B_NO_SOURCE`).

Job: `syllabus-generation-background.ts` (con recuperacion de generaciones obsoletas en `domains/syllabus/lib/syllabus-generation-recovery.ts`).

Estado esperado: `STEP_READY_FOR_QA`

### Fase 3: PLAN INSTRUCCIONAL

Define como se va a ensenar cada leccion.

Jobs: `instructional-plan-background.ts`, `validate-plan-background.ts`

Componentes soportados:

- `DIALOGUE`
- `READING`
- `QUIZ`
- `DEMO_GUIDE`
- `EXERCISE`
- `VIDEO_THEORETICAL`
- `VIDEO_DEMO`
- `VIDEO_GUIDE`

Los dialogos modernos usan el contrato `SOFLIA_DIALOGUE`. La publicacion bloquea dialogos legacy que no cumplan ese runtime.

### Fase 4: CURACION

Busca y valida fuentes educativas antes de generar materiales (curacion v2 en `netlify/functions/shared/curation-v2`).

Jobs:

- `curation-background.ts`
- `unified-curation-logic.ts`
- `validate-curation-background.ts`

Valida conectividad, soft 404, paywalls, duplicados, longitud minima y calidad educativa. Admin aprueba o rechaza fuentes en QA.

### Fase 5: MATERIALES

Genera lecturas, quizzes, dialogos, ejercicios, guias, scripts y storyboards usando el plan y las fuentes aprobadas.

Jobs:

- `materials-generation-background.ts`
- `validate-materials-background.ts`

Comportamiento vigente:

- La generacion de video es por etapas: los componentes no audiovisuales se generan aparte y guion/storyboard se reparan de forma incremental contra el contrato editorial. Ver [docs/materials-video-generation.md](docs/materials-video-generation.md).
- Los guiones se aceptan dentro del intervalo minimo/maximo de duracion ampliado 5 % en cada extremo. Ver [docs/video-script-duration-acceptance.md](docs/video-script-duration-acceptance.md).
- Reintentos selectivos por leccion y recuperacion de corridas interrumpidas (`materials-generation-recovery.ts`).
- Panel de descargas por componente con exportacion JSON/ZIP sin rutas internas ni URLs firmadas; cada descarga o exportacion queda registrada en `asset_access_audit_events`.

La configuracion de modelos y prompts es modular por organizacion mediante `model_settings` y `system_prompts`.

### Fase 6: PRODUCCION AUDIOVISUAL

Convierte componentes de video en assets, slides, clips de avatar y composiciones finales. Ver [Produccion Audiovisual](#produccion-audiovisual).

---

## Produccion Audiovisual

### Editor De Composicion y HyperFrames

El editor nativo (`production/composition-editor`) gestiona assets, pistas, timecodes, profundidad de capas (0..10), mezcla de audio, autoorganizacion, presets de movimiento y propuestas del agente convertidas en patches validados. Cada version del documento es inmutable, se identifica con hash y se guarda via `append_video_composition_draft_document_v2`.

Capacidades agregadas recientemente:

- **Transiciones reales entre clips** con runtime compartido preview/render y crossfade de audio. ADR: [composition-transitions-v1](docs/architecture/composition-transitions-v1.md).
- **Correccion de color basica por clip** detras de `NEXT_PUBLIC_COMPOSITION_COLOR_GRADING_ENABLED`. ADR: [basic-color-correction-v1](docs/architecture/basic-color-correction-v1.md); el gate externo pendiente es publicar una version de `@hyperframes/core` que incluya los artefactos.
- **Texto y captions nativos** (`courseforge-composition-v3`, clips `TEXT`/`CAPTION`), importacion de captions y tipografias privadas por organizacion. Ver [native-text-captions-and-fonts](docs/architecture/native-text-captions-and-fonts.md).
- **Agrupacion de elementos en el timeline** y vinculo avatar + voz. Ver [composition-timeline-grouping](docs/composition-timeline-grouping.md).
- Inspector por pestanas, panel de seleccion, panel de comparacion de previews y controles de procesamiento de audio.

`document.motion` es la fuente canonica para motion; ver [ADR de motion](docs/architecture/adr-composition-motion-source-of-truth.md).

El render final se envia a **HyperFrames Cloud** (`/api/production/hyperframes/renders` + `hyperframes-render-background.ts`), con credencial por workspace (`hyperframes_workspace_connections`) o `HYPERFRAMES_CLOUD_API_KEY` global. El contrato de documento, SFX, preview, snapshot ZIP, entrega de medios y render se mantiene en [Fuente de verdad del flujo HyperFrames](docs/architecture/hyperframes-composition-render-flow-source-of-truth.md); todo cambio a ese flujo debe actualizar ese documento en el mismo PR.

### Ensamblado Independiente (Standalone)

`/admin/assembly` y `/admin/assembly/[projectId]/edit` permiten crear composiciones fuera de un curso (`standalone_assembly_projects`). La biblioteca de medios importa archivos por su naturaleza tecnica (sin clasificarlos como avatar/B-roll/voz/slides) via `POST /api/production/standalone/media`, admite HTML saneado y formato vertical 9:16. Estado y pendientes: [docs/standalone-free-assets-and-vertical-analysis.md](docs/standalone-free-assets-and-vertical-analysis.md).

### Procesamiento De Audio

Jobs creados con `POST /api/production/audio-processing/jobs` y consultados con `GET` en la misma ruta. Un worker en `apps/api` (`start:audio-worker`, imagenes `Dockerfile.audio-worker` y `Dockerfile.audio-worker-neural`) reclama jobs de `production_jobs` con leases por perfil (`claim_audio_processing_jobs_by_profile`).

Perfiles:

- `voice-course-v1`: cadena FFmpeg conservadora (pasa-altos, compresor, limitador, normalizacion de loudness), salida AAC/M4A 48 kHz.
- `voice-clean-neural-dfn3-v1`: reduccion de ruido neural con DeepFilterNet; requiere `DEEPFILTERNET_ENABLED` y artefactos verificados por SHA-256.

La imagen neural se construye con el workflow manual `.github/workflows/build-audio-worker-neural.yml`. Licencias de modelos: [docs/compliance/audio-model-licenses.md](docs/compliance/audio-model-licenses.md).

### HeyGen

Estudio en `/admin/heygen` e integracion en `/admin/integrations`: avatares, voces, escenas, clips de avatar, videos standalone y presets. El catalogo se sincroniza con `heygen-catalog-background.ts` y se reconcilia cada 6 horas con `heygen-catalog-reconcile.ts`. La disponibilidad del proveedor y la visibilidad por organizacion se separan (`heygen_catalog_exclusions`); solo recursos privados `AVAILABLE` y no archivados pueden usarse. Contrato: [docs/heygen_catalog_sync_source_of_truth.md](docs/heygen_catalog_sync_source_of_truth.md).

### Slides, Fuentes y Efectos De Sonido

- Generacion de slides y decks animados (`/admin/slides`, `/admin/slides/templates`, `/api/production/slides/*`, `slides-generation-background.ts`).
- Open Design: `POST /api/production/open-design/html-to-png` y `POST /api/production/open-design/export`.
- Tipografias de organizacion: `GET/POST /api/admin/fonts` con politica de upload endurecida para video.
- Efectos de sonido con preview y descarga (`/api/production/sound-effects/*`).

### Automatizacion y Remotion

- Corridas de automatizacion de produccion (`/api/production/automation/runs/*`, `production-automation-background.ts`, reconciliacion cada 2 minutos).
- Remotion 4.0.484 se usa para el Player, composiciones internas (`apps/web/src/remotion`) y el bundle agent conversacional en `/admin/remotion/bundle-agent`.

> **Worker de escritorio retirado.** `/downloads` redirige a `/admin` y las rutas Next.js `/api/v1/production/remotion/*` y `/admin/worker-telemetry` se eliminaron (`d0b18ed4`). Solo queda `GET /api/v1/production/jobs/:jobId/status`. Aun existen referencias residuales (`RENDER_PROVIDER`, `getRenderWorkerStatusAction` en `production.actions.ts`, tablas `render_worker_*`) pendientes de limpieza.

---

## Auth, Tenancy y Publicacion

SofLIA - Engine usa un Auth Bridge:

1. El usuario inicia sesion con credenciales SofLIA, o llega con una sesion de PulseHub.
2. El sistema valida contra SofLIA.
3. Emite JWT HS256 con `jose`.
4. Guarda cookies como `cf_access_token`, `cf_active_org`, `cf_user_orgs` y `cf_remember_me`.
5. Sincroniza perfil local en `profiles`.

**Sesion PulseHub** (`POST /api/auth/hub-session`): recibe el access token de SofLIA como `Bearer`, exige el header `x-pulsehub-session: 1` y mismo origen (acepta el origen HTTPS publico detras de Netlify), verifica el token con `SOFLIA_AUTH_SUPABASE_ANON_KEY`, aplica rate limit por usuario y completa el login SSO. Si ya existe una sesion web la conserva salvo que el cuerpo pida `{ "replace": true }`.

El sistema es multi-tenant:

- rutas globales: `/admin`, `/builder`, `/architect`
- rutas por empresa: `/[empresaSlug]/admin`, `/[empresaSlug]/builder`, `/[empresaSlug]/architect`
- `organization_id` filtra artefactos, settings, prompts, credenciales, fuentes, assets e importaciones
- el cambio de organizacion reintenta la resolucion del tenant y muestra un estado explicito si el lookup no esta disponible

Publicacion:

- UI: `/admin/artifacts/[id]/publish`
- borrador: `POST /api/save-draft`
- envio: `POST /api/publish` (`POST /api/trigger-publish` reexporta el mismo handler)
- outbox: `publication-outbox-background.ts` con reconciliacion cada 5 minutos
- tabla: `publication_requests`
- destino: SofLIA

---

## Consola De Plataforma y Consumo De IA

`/platform` (redirige a `/platform/ai-usage`) es una consola para operadores de plataforma. Los permisos se revalidan contra SofLIA en cada request protegida; el claim del JWT solo se usa para navegacion.

El monitoreo de IA registra eventos por proveedor (`gemini`, `openai`) en `ai_usage_events`, versiones de precios en `ai_pricing_versions` y costo diario del proveedor en `ai_provider_cost_daily`. `sync-openai-usage.ts` sincroniza el consumo de OpenAI cada hora y el dashboard se sirve con el RPC `get_ai_usage_dashboard`.

---

## APIs y Jobs

### Next.js API Routes

Auth:

- `POST /api/auth/login`
- `POST /api/auth/sign-up`
- `GET /api/auth/callback`
- `POST /api/auth/hub-session`
- `POST /api/auth/switch-organization`
- `GET /api/auth/google/login`, `GET /api/auth/google/callback`, `POST /api/auth/google/disconnect`
- `GET /api/auth/microsoft/login`, `GET /api/auth/microsoft/callback`, `POST /api/auth/microsoft/disconnect`

Pipeline y publicacion:

- `POST /api/lia`
- `GET/POST/PATCH/DELETE /api/syllabus`
- `POST /api/syllabus/documents`
- `GET /api/syllabus/prompt`
- `POST /api/save-draft`
- `POST /api/publish`
- `POST /api/trigger-publish` (alias de `/api/publish`)
- `GET /api/materials/components/:componentId/downloads`
- `GET /api/materials/components/:componentId/export`

Admin:

- `POST /api/admin/users`
- `POST /api/admin/scorm/upload`
- `POST /api/admin/scorm/process`
- `GET/POST /api/admin/fonts`
- `/api/admin/slides/fonts`, `/api/admin/slides/html-preview`
- `/api/admin/remotion/bundle-agent/...`
- `GET /api/admin/remotion/template-versions/:versionId/download`

Storage y medios:

- `POST /api/storage/signed-upload-url`
- `GET /api/storage/media`
- `GET /api/video-metadata`

Produccion (`/api/production/...`):

- `assets/:assetId/download`
- `audio-processing/jobs`
- `assembly-branding`
- `automation/runs/...`
- `cloud-storage/import`, `cloud-storage/list`
- `google-drive/import`, `google-drive/list`
- `artlist/import`, `artlist/search`
- `import-external`
- `heygen/...` (assets, clips, connection, jobs, platform, presets, scenes, speech, standalone/videos, sync, videos)
- `hyperframes/...` (assets, composition-presets, compositions, connection, drafts, renders, revisions, settings)
- `liveavatar`
- `open-design/html-to-png`, `open-design/export`
- `slides/...` (animated-deck/prepare, appearance, generate, html-preview, jobs, templates)
- `sound-effects`, `sound-effects/:id/download`, `sound-effects/:id/preview`
- `standalone/media`

Control plane residual:

- `GET /api/v1/production/jobs/:jobId/status`

### Netlify Functions

Background:

- `generate-artifact-background.ts`
- `syllabus-generation-background.ts`
- `instructional-plan-background.ts`
- `validate-plan-background.ts`
- `curation-background.ts`
- `validate-curation-background.ts`
- `materials-generation-background.ts`
- `validate-materials-background.ts`
- `scorm-parsing-background.ts`
- `scorm-transformation-background.ts`
- `slides-generation-background.ts`
- `heygen-avatar-clips-background.ts`
- `heygen-avatar-video-background.ts`
- `heygen-catalog-background.ts`
- `hyperframes-render-background.ts`
- `production-automation-background.ts`
- `publication-outbox-background.ts`

Programadas:

| Funcion | Cron |
| --- | --- |
| `production-automation-reconcile.ts` | `*/2 * * * *` |
| `publication-outbox-reconcile.ts` | `*/5 * * * *` |
| `assembly-branding-upload-cleanup.ts` | `17 * * * *` |
| `sync-openai-usage.ts` | `23 * * * *` |
| `heygen-catalog-reconcile.ts` | `17 */6 * * *` |

Otras: `auth-sync.ts`, `unified-curation-logic.ts`, `video-prompts-generation.ts`.

---

## Datos y Storage

Tablas clave (no exhaustivo; las migraciones en `supabase/migrations` son la referencia):

- Base: `profiles`, `organizations`, `organization_user_roles`, `artifacts`, `syllabus`, `instructional_plans`, `pipeline_events`, `background_request_nonces`
- Curacion y materiales: `curation`, `curation_rows`, `materials`, `material_lessons`, `material_components`
- Configuracion: `model_settings`, `system_prompts`
- Publicacion e importacion: `publication_requests`, `scorm_imports`, `scorm_resources`
- Composicion: `video_compositions`, `video_composition_drafts`, `video_composition_draft_documents`, `video_composition_revisions`, `video_composition_agent_proposals`, `video_composition_presets`, `video_composition_preset_applications`, `standalone_assembly_projects`
- HyperFrames: `hyperframes_workspace_connections`, `hyperframes_render_requests`
- HeyGen: `heygen_workspace_connections`, `heygen_workspace_settings`, `heygen_avatar_presets`, `heygen_voice_presets`, `heygen_provider_assets`, `heygen_catalog_sync_runs`, `heygen_catalog_exclusions`, `heygen_standalone_assets`
- Assets y produccion: `production_jobs`, `production_evidence`, `production_render_batches`, `production_render_batch_items`, `sound_effect_assets`, `organization_slide_fonts`, `organization_assembly_assets`, `organization_assembly_settings`, `slide_documents`, `slide_document_versions`, `asset_access_audit_events`
- Consumo de IA: `ai_usage_events`, `ai_pricing_versions`, `ai_provider_cost_daily`, `ai_usage_reconciliation`
- Remotion y bundle agent: `remotion_templates`, `remotion_template_versions`, `remotion_template_builds`, `remotion_template_previews`, `soflia_bundle_conversations`, `soflia_bundle_messages`, `soflia_bundle_specs`, `soflia_bundle_generation_runs`
- Credenciales: `user_cloud_storage_credentials`, `user_google_credentials`
- Legacy del worker de escritorio: `render_workers`, `render_worker_link_codes`, `render_worker_job_recovery_states`, `render_worker_job_runs`, `render_worker_job_metric_samples`

Storage:

- `scorm-packages`
- `thumbnails`
- `production-videos`
- buckets de tipografias, assets de composicion y branding segun migraciones

---

## Variables De Entorno

No versionar valores reales.

Base:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COURSEFORGE_JWT_SECRET`
- `BACKGROUND_FUNCTION_SECRET` (secreto dedicado de al menos 32 caracteres para firmar jobs internos; obligatorio en produccion. En desarrollo local se deriva de `COURSEFORGE_JWT_SECRET` si no esta configurado)
- `NEXT_PUBLIC_APP_URL`
- `SOFLIA_ENGINE_WEB_URL`
- `SOFLIA_API_URL`
- `SOFLIA_API_KEY`
- `SOFLIA_INBOX_SUPABASE_URL`
- `SOFLIA_INBOX_SUPABASE_KEY`
- `SOFLIA_AUTH_SUPABASE_ANON_KEY` (verificacion de sesiones PulseHub)

Las invocaciones directas de handlers en `localhost` validan firma y expiracion, pero no persisten nonces. Los despliegues requieren la migracion de `background_request_nonces` y consumen cada nonce una sola vez.

IA:

- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GOOGLE_API_KEY`
- `GEMINI_MODEL`, `GEMINI_SEARCH_MODEL`, `GEMINI_BUNDLE_AGENT_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_CURATION_MODEL`, `OPENAI_BUNDLE_AGENT_MODEL`
- `OPENAI_ADMIN_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` (sincronizacion de consumo OpenAI)

Integraciones:

- `HEYGEN_API_KEY`
- `HYPERFRAMES_CLOUD_API_KEY`
- `ARTLIST_CLIENT_ID`
- `ARTLIST_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY`
- `NEXT_PUBLIC_GOOGLE_APP_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_REDIRECT_URI`
- `OAUTH_TOKEN_CRYPTO_SECRET`
- `GOOGLE_OAUTH_CRYPTO_SECRET`

Feature flags del editor:

- `NEXT_PUBLIC_COMPOSITION_COLOR_GRADING_ENABLED`
- `NEXT_PUBLIC_COMPOSITION_MOTION_ENABLED`
- `NEXT_PUBLIC_COMPOSITION_PREVIEW_SYNC_V2_ENABLED`

Worker de audio (`apps/api`):

- `AUDIO_PROCESSING_POLL_MILLISECONDS`, `AUDIO_PROCESSING_BATCH_SIZE`
- `DEEPFILTERNET_ENABLED`
- `DEEPFILTER_BINARY_PATH`, `DEEPFILTER_BINARY_SHA256`
- `DEEPFILTER_MODEL_PATH`, `DEEPFILTER_MODEL_SHA256`
- `DEEPFILTER_MANIFEST_PATH`

Residuales del worker de escritorio (aun leidas por codigo, sin rutas activas):

- `PRODUCTION_API_URL`
- `RENDER_PROVIDER`
- `REMOTION_DESKTOP_WORKER_TOKEN_PEPPER`
- `REMOTION_DESKTOP_WORKER_LINK_CODE_PEPPER`
- `DESKTOP_WORKER_SIGNED_URL_TTL_SECONDS`

---

## Validacion

TypeScript de frontend:

```bash
npx tsc -p apps/web/tsconfig.json --noEmit
```

Suites por area (`apps/web`; compilan con `tsc` hacia `.tmp/` y ejecutan con `node`):

```bash
npm run test:auth-bridge --workspace=apps/web
npm run test:ai-usage --workspace=apps/web
npm run test:curation --workspace=apps/web
npm run test:materials-generation --workspace=apps/web
npm run test:video-duration --workspace=apps/web
npm run test:hyperframes --workspace=apps/web
npm run test:composition-transitions --workspace=apps/web
npm run test:composition-timeline --workspace=apps/web
npm run test:publication --workspace=apps/web
npm run test:remotion --workspace=apps/web
npm run test:security-boundaries --workspace=apps/web
```

Worker de audio:

```bash
npm run test:audio-processing
npm run lint --workspace=apps/api
npm run verify:deepfilter-artifacts --workspace=apps/api
```

---

## Reglas De Mantenimiento

- Mantener `SofLIA - Engine` como nombre principal del producto.
- No renombrar variables legacy que aun existen en codigo, como `COURSEFORGE_JWT_SECRET`.
- No asumir que un template Remotion subido se ejecuta directamente: debe pasar por validacion, aprobacion y build cuando aplique.
- Propagar `organization_id` en rutas, acciones, OAuth state, credenciales y jobs.
- Mantener los contratos publicables de `SOFLIA_DIALOGUE`.
- Separar preview interno, preview externo sandbox y render final al diagnosticar produccion visual.
- Aplicar [el protocolo de investigacion y sincronizacion](docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md) antes de declarar vigente esta documentacion o el contexto operativo en `docs/architecture/system-context.md`.
