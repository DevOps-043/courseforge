# SofLIA - Engine

SofLIA - Engine es una plataforma multi-tenant para crear, validar, producir y publicar cursos con IA. Convierte una idea o un paquete SCORM en un artefacto educativo con syllabus, plan instruccional, fuentes curadas, materiales, assets visuales, ensamblado Remotion y publicacion hacia SofLIA.

## Estado Real Del Sistema

- **Monorepo npm workspaces**: `apps/web` y `apps/api`.
- **Frontend**: Next.js 16, React 19, TypeScript, TailwindCSS 4, Zustand, Remotion Player.
- **Backend web**: Next.js API routes y Netlify Functions para jobs largos del pipeline.
- **Backend de produccion**: Next.js API routes para `desktop_worker`; Express en `apps/api` queda como camino legacy para render local/Lambda.
- **DB/Auth**: Supabase PostgreSQL con RLS, tabla `profiles`, Auth Bridge JWT HS256 y soporte multi-organizacion.
- **IA**: Google Gemini como proveedor principal; OpenAI como fallback y para el bundle agent de Remotion.
- **Servicios**: Gamma API, Google Search grounding, SofLIA API, Google Drive, Microsoft Graph/OneDrive, Artlist, AWS Remotion Lambda, S3, CodeBuild y CloudFront para templates externos.

## Comandos

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test:remotion --workspace=apps/web
npm run test:remotion --workspace=apps/api
```

Notas:

- `npm run dev` levanta `apps/web` en `:3000`.
- `npm run dev:legacy-api` levanta `apps/api` en `:4000` solo para diagnosticar el camino Express.
- En `apps/web`, `npm run lint` sigue usando `next lint`; para validacion confiable de TypeScript usa `npx tsc -p apps/web/tsconfig.json --noEmit`.
- Para cambios de Remotion o produccion visual, ejecuta los tests Remotion del workspace afectado.

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
    src/features/auth/       Auth auxiliar
    src/features/production/ API Express legacy para render, previews y builds
packages/
  shared/
  ui/
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
- Modelo principal: Gemini (`gemini-2.0-flash` por defecto en los prompts actuales)
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
- Slides/Gamma y exportes visuales
- Importacion de assets desde Google Drive, OneDrive/cloud storage y Artlist
- Composiciones Remotion internas en `apps/web/src/remotion`
- Templates Remotion versionados y validados
- Bundle agent para generar specs/bundles desde conversacion
- Preview externo de bundles aprobados
- Render final mediante worker de escritorio y rutas Next.js

## Remotion y Produccion

El control plane activo vive en `apps/web` bajo `/api/v1/production` y expone:

- `POST /remotion/render`
- `GET /remotion/readiness`
- `GET /remotion/workers`
- `POST /remotion/workers/link-codes`
- `POST /remotion/workers/link`
- `POST /remotion/workers/heartbeat`
- `POST /remotion/workers/jobs/claim-next`
- `POST /remotion/workers/jobs/:jobId/claim`
- `POST /remotion/workers/jobs/:jobId/progress`
- `POST /remotion/workers/jobs/:jobId/complete`
- `POST /remotion/workers/jobs/:jobId/fail`
- `GET /jobs/:jobId/status`

`apps/api` conserva endpoints legacy para render local/Lambda, previews externos y builds cloud.

Proveedores de render:

- `local`
- `lambda`
- `desktop_worker`

Reglas importantes:

- `RENDER_PROVIDER` decide el proveedor.
- En produccion local/Cloud Run se requieren timeouts altos para renders largos.
- Lambda requiere region, function name, serve URL y bucket.
- Templates externos deben pasar validacion, versionado, aprobacion y, para Lambda, build cloud compatible con Remotion `4.0.484`.
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
- `POST /api/gpt/sources`
- `GET /api/debug/soflia`
- `POST /api/production/cloud-storage/import`
- `GET /api/production/cloud-storage/list`
- `POST /api/production/google-drive/import`
- `GET /api/production/google-drive/list`
- `POST /api/production/artlist/import`
- `GET /api/production/artlist/search`
- `POST /api/admin/remotion/bundle-agent/*`

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
- `production_jobs`
- `production_evidence`
- `render_workers`
- `user_cloud_storage_credentials`
- `user_google_credentials`
- `organization_user_roles`

Storage buckets principales:

- `scorm-packages`
- `thumbnails`
- `production-videos`
- buckets Remotion/AWS segun entorno

## Variables De Entorno

No documentar valores reales. Solo nombres.

Base:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COURSEFORGE_JWT_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `SOFLIA_API_URL`
- `SOFLIA_API_KEY`
- `SOFLIA_INBOX_SUPABASE_URL`
- `SOFLIA_INBOX_SUPABASE_KEY`

IA:

- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GOOGLE_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BUNDLE_AGENT_MODEL`

Produccion y assets:

- `GAMMA_API_KEY`
- `GPT_SOURCES_API_KEY`
- `HEYGEN_API_KEY`
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

API/Remotion:

- `PRODUCTION_API_URL`
- `RENDER_PROVIDER`
- `REMOTION_DESKTOP_WORKER_TOKEN_PEPPER`
- `REMOTION_DESKTOP_WORKER_LINK_CODE_PEPPER`

API/Remotion legacy, solo si se usa `apps/api`:

- `EXPRESS_INTERNAL_API_URL`
- `EXPRESS_PUBLIC_URL`
- `API_PUBLIC_URL`
- `ALLOWED_ORIGINS`
- `REMOTION_ENTRY_POINT`
- `REMOTION_RENDER_TIMEOUT_MS`
- `EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS`
- `EXTERNAL_TEMPLATE_PREVIEW_RENDER_TIMEOUT_MS`
- `REMOTION_LAMBDA_*`
- `REMOTION_TEMPLATE_CODEBUILD_*`
- `AWS_ACCESS_KEY_ID` / `SOFLIA_AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY` / `SOFLIA_AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` / `SOFLIA_AWS_SESSION_TOKEN`

## Patrones Importantes

- Usar `profiles` en lugar de FK directas a `auth.users`.
- Mantener `organization_id` en flujos tenant-aware.
- No ejecutar bundles Remotion subidos sin validacion, versionado y aprobacion.
- Para templates externos, distinguir preview interno, preview sandbox y render final.
- No renombrar variables legacy aun usadas por codigo.
- Preferir validadores Zod y servicios de dominio sobre logica en componentes.
- Mantener business rules fuera de route handlers cuando exista dominio equivalente.
