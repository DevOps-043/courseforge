# SofLIA - Engine

SofLIA - Engine es una plataforma multi-tenant para crear, validar, producir y publicar cursos con IA. Convierte una idea o un paquete SCORM en un artefacto educativo con syllabus, plan instruccional, fuentes curadas, materiales, assets visuales, ensamblado Remotion y publicacion hacia SofLIA.

## Estado Real Del Sistema

- **Monorepo npm workspaces**: `apps/web` y `apps/api`.
- **Frontend**: Next.js 16, React 19, TypeScript, TailwindCSS 4, Zustand, Remotion Player.
- **Backend web**: Next.js API routes y Netlify Functions para jobs largos del pipeline.
- **Backend de produccion**: render final en HyperFrames Cloud via `/api/production/hyperframes/renders` y `hyperframes-render-background.ts`. El worker de escritorio Remotion fue retirado: las rutas `/api/v1/production/remotion/*` y `/admin/worker-telemetry` se eliminaron (`d0b18ed4`); solo queda `GET /api/v1/production/jobs/:jobId/status`.
- **`apps/api`**: worker de procesamiento de audio (`start:audio-worker`, FFmpeg + DeepFilterNet opcional) y un Express legado que solo expone `GET /health`. Ya no contiene render Remotion local/Lambda ni builds cloud.
- **DB/Auth**: Supabase PostgreSQL con RLS, tabla `profiles`, Auth Bridge JWT HS256, sesion PulseHub (`POST /api/auth/hub-session`) y soporte multi-organizacion.
- **IA**: Google Gemini como proveedor principal; OpenAI como fallback, curacion y bundle agent de Remotion. El consumo se registra en `ai_usage_events` y se consulta en `/platform/ai-usage`.
- **Servicios**: Google Search grounding, SofLIA API, PulseHub, HeyGen, HyperFrames Cloud, Google Drive, Microsoft Graph/OneDrive y Artlist.
- **Editor de composicion**: el dominio `production/composition-editor` gestiona documento, assets, pistas, mezcla de audio, profundidad de capas, presets de movimiento, auto-organizacion y patches validados de propuestas del agente. El documento se persiste como versiones inmutables con hash y auditoria; el RPC `append_video_composition_draft_document_v2` devuelve resultados explicitos de guardado y evita colas de bloqueo.
- **HyperFrames**: el dominio `production/hyperframes` cubre borradores, composiciones, preflight, revisiones, preview, render y sincronizacion de assets; sus rutas viven bajo `/api/production/hyperframes`.
- **Fuente de verdad HyperFrames**: antes de cambiar documento, SFX, preview, snapshot ZIP, variables, upload o render, leer y actualizar `docs/architecture/hyperframes-composition-render-flow-source-of-truth.md` en el mismo cambio.

## Protocolo De Sincronizacion Documental

Antes de declarar vigente esta guia o `README.md`, aplicar [docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md](docs/PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md): ejecutar `npm run docs:audit`, contrastar con evidencia primaria y actualizar ambos documentos solo con hechos verificables. La auditoria generada en `docs/documentation-audit.md` es evidencia temporal, no una tercera fuente de verdad.

## Comandos

```bash
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
npm run verify
npm run test:remotion --workspace=apps/web
npm run test:hyperframes --workspace=apps/web
npm run test:auth-bridge --workspace=apps/web
npm run test:curation --workspace=apps/web
npm run test:materials-generation --workspace=apps/web
npm run test:audio-processing
```

Notas:

- `npm run dev` levanta `apps/web` en `:3000`.
- `npm run dev:legacy-api` levanta el Express legado de `apps/api` (solo `GET /health`); el worker de audio corre con `npm run start:audio-worker --workspace=apps/api` tras compilar.
- En `apps/web`, `npm run lint` sigue usando `next lint`; para validacion confiable de TypeScript usa `npx tsc -p apps/web/tsconfig.json --noEmit`.
- En `apps/api`, `npm run lint` es `tsc --noEmit` (no hay ESLint en ese workspace).
- Los scripts `test:*` compilan primero con `tsc -p <tsconfig.*-test.json>` hacia `.tmp/` y luego ejecutan los `.js` resultantes con `node`; no son runners tipo Jest/Vitest, así que para correr un test individual hay que compilar y apuntar `node` directamente al archivo compilado bajo `.tmp/`.
- Para cambios de Remotion, HeyGen o slides ejecuta `test:remotion`; para editor de composicion o HyperFrames, `test:hyperframes` (y `test:composition-*` segun el area); para audio, `test:audio-processing`. Para cambios en Auth Bridge (`apps/web/src/app/login`) usa `test:auth-bridge`; para cambios en curacion (`netlify/functions/shared/curation-v2`) usa `test:curation`.

---

## Arquitectura

```text
apps/
  web/
    src/app/                 Next.js App Router, dashboards y API routes
    src/domains/             Dominios de negocio del frontend
    src/remotion/            Composiciones internas de Remotion
    netlify/functions/       Background jobs del pipeline educativo
  api/
    src/features/auth/              Auth auxiliar legado
    src/features/audio-processing/  Worker de procesamiento de audio
supabase/
  migrations/
  Scripts/
docs/
reportes/
scripts/
```

Los dominios en `apps/web/src/domains` siguen una convencion por capacidades: `actions`, `components`, `config`, `hooks`, `lib`, `services`, `types` y `validators` solo cuando el dominio lo necesita.

## Rutas y Roles

El sistema tiene rutas globales y rutas tenant-aware bajo `[empresaSlug]`.

- Admin: `/admin`, `/[empresaSlug]/admin`
- Builder: `/builder`, `/[empresaSlug]/builder`
- Architect: `/architect`, `/[empresaSlug]/architect`
- Login/registro: `/login`, `/register`
- Dashboard base: `/dashboard`

Areas admin principales:

- `/admin/artifacts` y `/admin/artifacts/[id]`
- `/admin/artifacts/new`
- `/admin/artifacts/[id]/publish`
- `/admin/library`
- `/admin/settings`
- `/admin/users`
- `/admin/integrations`
- `/admin/templates`
- `/admin/remotion/bundle-agent`

## Multi-tenancy y Auth Bridge

- El login valida credenciales contra SofLIA y emite JWT propio con `jose`.
- Las cookies principales son `cf_access_token`, `cf_active_org`, `cf_user_orgs` y `cf_remember_me`.
- El usuario puede pertenecer a varias organizaciones.
- `organization_id` se propaga a artefactos, settings, prompts, credenciales cloud, SCORM y flujos de produccion.
- El nombre de variable `COURSEFORGE_JWT_SECRET` sigue existiendo por compatibilidad y no debe renombrarse en documentacion tecnica si el codigo aun lo consume.

## SofLIA - Asistente IA

SofLIA es el asistente integrado en la app.

- API: `POST /api/lia`
- Modelo principal: Gemini (`gemini-3.5-flash` por defecto en los prompts actuales)
- Usa Google Search grounding cuando aplica.
- Responde en markdown con fuentes.
- Los prompts y contexto viven principalmente en servicios compartidos y resolvers de prompts.

## Pipeline De Creacion De Cursos

### Fase 1: BASE

Entrada: titulo, descripcion, publico objetivo y resultados esperados.

Proceso principal: `apps/web/netlify/functions/generate-artifact-background.ts`

Salida:

- `objetivos[]`
- `nombres[]`
- `generation_metadata`
- estado `GENERATING` -> `STEP_APPROVED`

### Fase 2: SYLLABUS

Proceso principal: `syllabus-generation-background.ts`

- Genera modulos y lecciones.
- Valida estructura y cobertura Bloom.
- Selecciona ruta `A_WITH_SOURCE` o `B_NO_SOURCE`.
- Estado esperado: `STEP_READY_FOR_QA`.

### Fase 3: PLAN INSTRUCCIONAL

Proceso principal: `instructional-plan-background.ts`

Genera `lesson_plans[]` con OA, nivel Bloom, criterios medibles y componentes:

- `DIALOGUE`
- `READING`
- `QUIZ`
- `DEMO_GUIDE`
- `EXERCISE`
- `VIDEO_THEORETICAL`
- `VIDEO_DEMO`
- `VIDEO_GUIDE`

Los componentes `DIALOGUE` modernos usan runtime `SOFLIA_DIALOGUE`; los formatos legacy deben regenerarse antes de publicar si no cumplen el contrato.

### Fase 4: CURACION

Procesos principales:

- `unified-curation-logic.ts`
- `curation-background.ts`
- `validate-curation-background.ts`

Busca fuentes con Gemini + Google Search grounding, valida URLs, contenido, paywalls, soft 404 y calidad minima. Admin aprueba o rechaza fuentes en QA.

### Fase 5: MATERIALES

Procesos principales:

- `materials-generation-background.ts`
- `validate-materials-background.ts`

Genera lecturas, quizzes, dialogos, ejercicios, guias demo y scripts/storyboards para video. Usa configuracion modular por organizacion en `model_settings` y `system_prompts`.

### Fase 6: PRODUCCION VISUAL

Incluye:

- Prompts de B-roll (`video-prompts-generation.ts`)
- Slides, decks animados y Open Design (`/api/production/slides/*`, `/api/production/open-design/*`)
- Importacion de assets desde Google Drive, OneDrive/cloud storage y Artlist
- HeyGen: avatares, voces, clips y catalogo reconciliado (`docs/heygen_catalog_sync_source_of_truth.md`)
- Editor de composicion: transiciones, correccion de color (flag), texto/captions nativos, tipografias por organizacion y agrupacion de timeline (ADRs en `docs/architecture/`)
- Ensamblado standalone en `/admin/assembly` (medios libres, formato 9:16)
- Procesamiento de audio (`/api/production/audio-processing/jobs`, worker en `apps/api`)
- Composiciones Remotion internas en `apps/web/src/remotion` y bundle agent
- Render final en HyperFrames Cloud

## Remotion y Produccion

- Render final: HyperFrames Cloud (`/api/production/hyperframes/renders`, `hyperframes-render-background.ts`), con credencial por workspace o `HYPERFRAMES_CLOUD_API_KEY`.
- Remotion 4.0.484 se usa para Player, composiciones internas y bundle agent; no hay render Lambda ni builds CodeBuild en el codigo actual.
- Worker de escritorio retirado: `/downloads` redirige a `/admin`. Quedan residuos pendientes de limpieza (`RENDER_PROVIDER`, `PRODUCTION_API_URL`, `getRenderWorkerStatusAction` en `production.actions.ts`, `desktop-worker-*.ts` en `lib/server`, tablas `render_worker_*`). No reintroducir dependencias de esas rutas.
- El API redacta secretos en logs y diagnosticos.

## Importacion SCORM

Dominio: `apps/web/src/domains/scorm`

Flujo:

1. Upload de `.zip` a storage.
2. Parsing de manifest, SCOs, recursos y HTML.
3. Analisis de componentes, quizzes y gaps.
4. Enriquecimiento con Gemini.
5. Transformacion a estructura SofLIA - Engine.

Rutas:

- `POST /api/admin/scorm/upload`
- `POST /api/admin/scorm/process`

Tablas principales: `scorm_imports`, `scorm_resources`.

## Publicacion a SofLIA

Ruta principal: `/admin/artifacts/[id]/publish`

Flujo:

1. Completar metadata del curso.
2. Seleccionar lecciones.
3. Mapear videos por leccion.
4. Guardar borrador con `POST /api/save-draft`.
5. Publicar con `POST /api/publish`.

La publicacion valida el contrato `SOFLIA_DIALOGUE` para dialogos modernos y bloquea dialogos legacy cuando no son publicables.

## APIs Web Principales

- `POST /api/auth/login`
- `POST /api/auth/sign-up`
- `GET /api/auth/callback`
- `POST /api/auth/hub-session` (sesion PulseHub; header `x-pulsehub-session: 1`, mismo origen, rate limit)
- `POST /api/auth/switch-organization`
- `GET /api/auth/google/login`
- `GET /api/auth/google/callback`
- `GET /api/auth/microsoft/login`
- `GET /api/auth/microsoft/callback`
- `POST /api/lia`
- `POST /api/syllabus`
- `POST /api/save-draft`
- `POST /api/publish`
- `POST /api/admin/users`
- `POST /api/admin/scorm/upload`
- `POST /api/admin/scorm/process`
- `GET /api/materials/components/:componentId/downloads` y `/export` (auditados en `asset_access_audit_events`)
- `POST /api/production/audio-processing/jobs`
- `POST /api/production/standalone/media`
- `/api/production/hyperframes/*`, `/api/production/heygen/*`, `/api/production/slides/*`
- `POST /api/production/cloud-storage/import`
- `GET /api/production/cloud-storage/list`
- `POST /api/production/google-drive/import`
- `GET /api/production/google-drive/list`
- `POST /api/production/artlist/import`
- `GET /api/production/artlist/search`
- `POST /api/admin/remotion/bundle-agent/*`

Inventario completo de rutas y Netlify Functions (incluidas las programadas): ver `README.md`.

## Base de Datos

Tablas y areas relevantes:

- `profiles`
- `artifacts`
- `syllabus`
- `instructional_plans`
- `curation`, `curation_rows`
- `materials`, `material_lessons`, `material_components`
- `publication_requests`
- `scorm_imports`, `scorm_resources`
- `model_settings`
- `system_prompts`
- `pipeline_events`
- `remotion_templates`
- `remotion_template_versions`
- `remotion_template_builds`
- `production_jobs` (incluye leases de jobs de audio)
- `production_evidence`
- `video_composition_*`, `standalone_assembly_projects`
- `hyperframes_workspace_connections`, `hyperframes_render_requests`
- `heygen_*` (incluye `heygen_catalog_exclusions`)
- `ai_usage_events`, `ai_pricing_versions`, `ai_provider_cost_daily`
- `asset_access_audit_events`
- `background_request_nonces`
- `render_worker_*` (legacy del worker de escritorio retirado)
- `user_cloud_storage_credentials`
- `user_google_credentials`
- `organization_user_roles`

Storage buckets principales:

- `scorm-packages`
- `thumbnails`
- `production-videos`
- buckets de tipografias, assets de composicion y branding segun migraciones

## Variables De Entorno

No documentar valores reales. Solo nombres.

Base:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COURSEFORGE_JWT_SECRET`
- `BACKGROUND_FUNCTION_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `SOFLIA_ENGINE_WEB_URL`
- `SOFLIA_API_URL`
- `SOFLIA_API_KEY`
- `SOFLIA_INBOX_SUPABASE_URL`
- `SOFLIA_INBOX_SUPABASE_KEY`
- `SOFLIA_AUTH_SUPABASE_ANON_KEY`

IA:

- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GOOGLE_API_KEY`
- `GEMINI_MODEL`, `GEMINI_SEARCH_MODEL`, `GEMINI_BUNDLE_AGENT_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_CURATION_MODEL`, `OPENAI_BUNDLE_AGENT_MODEL`
- `OPENAI_ADMIN_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`

Produccion y assets:

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
- `DEEPFILTERNET_ENABLED`, `DEEPFILTER_BINARY_PATH`, `DEEPFILTER_BINARY_SHA256`, `DEEPFILTER_MODEL_PATH`, `DEEPFILTER_MODEL_SHA256`, `DEEPFILTER_MANIFEST_PATH`

Residuales del worker de escritorio retirado (aun leidas por codigo):

- `PRODUCTION_API_URL`
- `RENDER_PROVIDER`
- `REMOTION_DESKTOP_WORKER_TOKEN_PEPPER`
- `REMOTION_DESKTOP_WORKER_LINK_CODE_PEPPER`
- `DESKTOP_WORKER_SIGNED_URL_TTL_SECONDS`

## Patrones Importantes

- Usar `profiles` en lugar de FK directas a `auth.users`.
- Mantener `organization_id` en flujos tenant-aware.
- No ejecutar bundles Remotion subidos sin validacion, versionado y aprobacion.
- Para templates externos, distinguir preview interno, preview sandbox y render final.
- Registrar descargas/exportaciones de assets en `asset_access_audit_events` y no exponer rutas de storage ni URLs firmadas en exportaciones.
- HeyGen: solo recursos `private`, `AVAILABLE` y no archivados son seleccionables; ver `docs/heygen_catalog_sync_source_of_truth.md`.
- No renombrar variables legacy aun usadas por codigo.
- Preferir validadores Zod y servicios de dominio sobre logica en componentes.
- Mantener business rules fuera de route handlers cuando exista dominio equivalente.
- Mantener `courseforge-composition-v2` como unica fuente editable para motion: `document.motion` es canonico y el HTML/timeline se compila desde ese documento. Ver [ADR de motion](docs/architecture/adr-composition-motion-source-of-truth.md).
- Para medios y render HyperFrames, mantener separados el snapshot inmutable sin credenciales y el ZIP desechable con URLs firmadas materializadas justo antes del upload. Ver [fuente de verdad del flujo](docs/architecture/hyperframes-composition-render-flow-source-of-truth.md).
