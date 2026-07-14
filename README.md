# SofLIA - Engine

> Plataforma multi-tenant de ingenieria instruccional con IA.

SofLIA - Engine crea cursos completos a partir de una idea o de un paquete SCORM: investiga, estructura, planifica, cura fuentes, genera materiales, produce assets visuales, ensambla videos con Remotion y publica el resultado hacia SofLIA.

El producto ya no es solo un generador de cursos. Es un flujo operativo con aprobaciones humanas, contratos de datos, configuracion por organizacion, importacion de assets externos y una capa de produccion visual que puede renderizar localmente, en AWS Lambda o mediante worker de escritorio.

## Tabla De Contenidos

1. [Stack](#stack)
2. [Estructura Del Repo](#estructura-del-repo)
3. [Como Correrlo](#como-correrlo)
4. [Arquitectura Actual](#arquitectura-actual)
5. [Pipeline Educativo](#pipeline-educativo)
6. [Produccion Visual y Remotion](#produccion-visual-y-remotion)
7. [Auth, Tenancy y Publicacion](#auth-tenancy-y-publicacion)
8. [APIs y Jobs](#apis-y-jobs)
9. [Datos y Storage](#datos-y-storage)
10. [Variables De Entorno](#variables-de-entorno)
11. [Validacion](#validacion)

---

## Stack

| Capa | Tecnologia |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript |
| UI | TailwindCSS 4, Framer Motion, lucide-react, Sonner |
| Estado | Zustand |
| Backend web | Next.js API routes + Netlify Functions |
| Backend produccion | Next.js API routes para `desktop_worker`; Express en `apps/api` solo legado |
| DB/Auth | Supabase PostgreSQL, RLS, Auth Bridge JWT HS256 |
| IA | Google Gemini principal, OpenAI fallback/bundle agent |
| Video | Remotion 4.0.484, Remotion Player, Remotion Lambda |
| Integraciones | SofLIA API, Gamma, Google Search, Google Drive, Microsoft Graph, Artlist, AWS S3/CodeBuild/CloudFront |

---

## Estructura Del Repo

```text
apps/
  web/
    src/app/                 App Router, dashboards, API routes
    src/domains/             Logica de negocio por dominio
    src/remotion/            Composiciones internas Remotion
    netlify/functions/       Jobs background del pipeline
  api/
    src/server.ts            API Express legado
    src/features/auth/       Auth auxiliar legado
    src/features/production/ Render Remotion legacy, previews, Lambda
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

Dominios principales en `apps/web/src/domains`:

- `artifacts`
- `syllabus`
- `plan`
- `curation`
- `materials`
- `production`
- `publication`
- `scorm`
- `library`
- `prompts`

---

## Como Correrlo

```bash
npm install
npm run dev
```

`npm run dev` levanta:

- `apps/web`: Next.js en `http://localhost:3000`

Comandos utiles:

```bash
npm run build
npm run lint
npx tsc -p apps/web/tsconfig.json --noEmit
npm run test:remotion --workspace=apps/web
npm run dev:legacy-api
npm run test:remotion --workspace=apps/api
```

Nota: el lint de `apps/web` aun depende de `next lint`; para validar TypeScript del frontend usa `npx tsc -p apps/web/tsconfig.json --noEmit`.

---

## Arquitectura Actual

SofLIA - Engine funciona principalmente desde `apps/web`:

1. **`apps/web`**: interfaz, dashboards, API routes, Auth Bridge, pipeline educativo, importaciones, publicacion, validaciones de templates, preview con Remotion Player y control plane del worker de escritorio.
2. **`apps/api`**: API Express legado para render local/Lambda, previews externos y builds cloud. No es requisito para el flujo activo con `desktop_worker`.

El sistema esta organizado alrededor de dominios de negocio. La regla en `apps/web/src/domains` es crear carpetas por capacidad solo cuando hacen falta:

- `actions`
- `components`
- `config`
- `hooks`
- `lib`
- `services`
- `types`
- `validators`

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

Genera la estructura de modulos y lecciones, valida rangos y decide si el curso requiere fuentes externas.

Job: `syllabus-generation-background.ts`

Estado esperado: `STEP_READY_FOR_QA`

### Fase 3: PLAN INSTRUCCIONAL

Define como se va a ensenar cada leccion.

Job: `instructional-plan-background.ts`

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

Busca y valida fuentes educativas antes de generar materiales.

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

La configuracion de modelos y prompts es modular por organizacion mediante `model_settings` y `system_prompts`.

### Fase 6: PRODUCCION VISUAL

Convierte componentes de video en assets, prompts, slides y ensamblados.

Incluye:

- B-roll prompts (`video-prompts-generation.ts`)
- Slides y Gamma
- Importacion de archivos desde Google Drive, OneDrive/cloud storage y Artlist
- Templates Remotion internos y externos
- Preview con Remotion Player
- Render final con worker de escritorio mediante rutas Next.js

---

## Produccion Visual y Remotion

El sistema activo usa `desktop_worker`. Los caminos `local` y `lambda` quedan como legado en `apps/api`.

- `desktop_worker`
- `local` legacy
- `lambda` legacy

Se controlan con `RENDER_PROVIDER`.

### Control Plane Next.js

Base local: `http://localhost:3000/api/v1/production`

Endpoints principales:

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

### API Express Legacy

`apps/api` conserva endpoints para render local/Lambda, preview externo y builds cloud. Usar `npm run dev:legacy-api` solo cuando se necesite diagnosticar ese camino.

### Templates Remotion

El sistema soporta:

- `remotion_templates`
- `remotion_template_versions`
- `remotion_template_builds`
- validacion estatica de ZIPs
- aprobacion para sandbox
- builds cloud via AWS CodeBuild
- compatibilidad con Lambda y Remotion `4.0.484`
- bundle agent conversacional en `/admin/remotion/bundle-agent`

Los ZIPs subidos no deben tratarse como codigo confiable. Pasan por validacion, versionado, aprobacion, build aislado y diagnosticos antes de renderizarse.

### Worker De Escritorio

La API ya contiene endpoints y tablas para registrar workers, reclamar jobs, reportar progreso y completar/fallar renders. Esto permite sacar el computo pesado del servidor principal cuando el flujo usa `desktop_worker`.

---

## Auth, Tenancy y Publicacion

SofLIA - Engine usa un Auth Bridge:

1. El usuario inicia sesion con credenciales SofLIA.
2. El sistema valida contra SofLIA.
3. Emite JWT HS256 con `jose`.
4. Guarda cookies como `cf_access_token`, `cf_active_org`, `cf_user_orgs` y `cf_remember_me`.
5. Sincroniza perfil local en `profiles`.

El sistema es multi-tenant:

- rutas globales: `/admin`, `/builder`, `/architect`
- rutas por empresa: `/[empresaSlug]/admin`, `/[empresaSlug]/builder`, `/[empresaSlug]/architect`
- `organization_id` filtra artefactos, settings, prompts, credenciales e importaciones

Publicacion:

- UI: `/admin/artifacts/[id]/publish`
- borrador: `POST /api/save-draft`
- envio: `POST /api/publish`
- tabla: `publication_requests`
- destino: SofLIA

---

## APIs y Jobs

### Next.js API Routes

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
- `POST /api/admin/remotion/bundle-agent/...`

### Netlify Functions

- `auth-sync.ts`
- `generate-artifact-background.ts`
- `syllabus-generation-background.ts`
- `instructional-plan-background.ts`
- `validate-plan-background.ts`
- `curation-background.ts`
- `unified-curation-logic.ts`
- `validate-curation-background.ts`
- `materials-generation-background.ts`
- `validate-materials-background.ts`
- `video-prompts-generation.ts`

---

## Datos y Storage

Tablas clave:

- `profiles`
- `artifacts`
- `syllabus`
- `instructional_plans`
- `curation`
- `curation_rows`
- `materials`
- `material_lessons`
- `material_components`
- `publication_requests`
- `scorm_imports`
- `scorm_resources`
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

Storage:

- `scorm-packages`
- `thumbnails`
- `production-videos`
- buckets AWS/S3 para Remotion Lambda y builds de templates

---

## Variables De Entorno

No versionar valores reales.

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

Integraciones:

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

Produccion:

- `PRODUCTION_API_URL`
- `RENDER_PROVIDER`
- `REMOTION_DESKTOP_WORKER_TOKEN_PEPPER`
- `REMOTION_DESKTOP_WORKER_LINK_CODE_PEPPER`

Legacy Express/Lambda, solo si se usa `apps/api`:

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

---

## Validacion

Para cambios generales de frontend:

```bash
npx tsc -p apps/web/tsconfig.json --noEmit
```

Para Remotion/frontend:

```bash
npm run test:remotion --workspace=apps/web
```

Para Remotion/API legacy:

```bash
npm run test:remotion --workspace=apps/api
npm run lint --workspace=apps/api
```

Para verificar readiness del control plane activo:

```bash
curl http://localhost:3000/api/v1/production/remotion/readiness
```

---

## Reglas De Mantenimiento

- Mantener `SofLIA - Engine` como nombre principal del producto.
- No renombrar variables legacy que aun existen en codigo, como `COURSEFORGE_JWT_SECRET`.
- No asumir que un template Remotion subido se ejecuta directamente: debe pasar por validacion, aprobacion y build cuando aplique.
- Propagar `organization_id` en rutas, acciones, OAuth state, credenciales y jobs.
- Mantener los contratos publicables de `SOFLIA_DIALOGUE`.
- Separar preview interno, preview externo sandbox y render final al diagnosticar produccion visual.
