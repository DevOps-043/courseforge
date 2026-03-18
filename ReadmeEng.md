# CourseForge - Plataforma de Ingeniería Instruccional con IA

> **Versión**: 1.1.0
> **Estado**: Producción (Beta)
> **Stack**: Next.js 16, React 19, Supabase, Netlify Functions, Google Gemini

CourseForge es un **Sistema Operativo de Diseño Instruccional** que orquesta múltiples agentes de IA para investigar, estructurar, redactar y validar contenido educativo de alta calidad. Se integra con **SofLIA** como plataforma receptora de cursos publicados.

El sistema simula el flujo de trabajo de un equipo humano (Investigador + Diseñador Instruccional + Redactor + Editor), donde la salida de cada fase es rigurosamente validada antes de ser utilizada como entrada para la siguiente.

---

## Tabla de Contenidos

1. [Filosofía del Sistema](#filosofía-del-sistema)
2. [Arquitectura Técnica](#arquitectura-técnica)
3. [Autenticación - Auth Bridge](#autenticación---auth-bridge)
4. [El Pipeline de Creación (6 Fases)](#el-pipeline-de-creación-6-fases)
5. [Lia - Asistente IA](#lia---asistente-ia)
6. [Publicación a SofLIA](#publicación-a-soflia)
7. [SCORM Import](#scorm-import)
8. [Admin Dashboard](#admin-dashboard)
9. [Modelo de Datos](#modelo-de-datos)
10. [API Routes](#api-routes)
11. [Guía de Desarrollo](#guía-de-desarrollo)

---

## Filosofía del Sistema

CourseForge se basa en tres principios no negociables:

1. **NO A LA ALUCINACIÓN**: A diferencia de ChatGPT, CourseForge _no inventa_ hechos. Utiliza un motor de curaduría (Fase 4) que busca referencias reales, verifica que las URLs funcionen (HTTP 200) y valida que el contenido sea relevante antes de usarlo para escribir.
2. **ESTRUCTURA PRIMERO, CONTENIDO DESPUÉS**: No se genera texto hasta que no haya un plan instruccional aprobado (Fase 3). Esto asegura coherencia pedagógica.
3. **HUMAN-IN-THE-LOOP (HITL)**: El sistema se detiene entre fases críticas, permitiendo que un experto humano revise y apruebe el syllabus o las fuentes antes de continuar.

---

## Arquitectura Técnica

El proyecto es un **Monorepo** gestionado con npm workspaces, implementando "Screaming Architecture" donde la estructura de carpetas refleja el dominio del negocio.

### Tecnologías Clave

| Capa          | Tecnología                                                   |
| ------------- | ------------------------------------------------------------ |
| Frontend      | Next.js 16, React 19, TypeScript                             |
| Estilos       | TailwindCSS 4.x, Framer Motion                               |
| Estado        | Zustand                                                      |
| Backend       | Express + Netlify Functions (Node.js 20+)                    |
| Base de datos | Supabase (PostgreSQL 15)                                     |
| Auth          | Auth Bridge JWT (HS256, `jose`) + Supabase GoTrue            |
| IA Principal  | Google Gemini (`gemini-2.0-flash`, `gemini-3-flash-preview`) |
| IA Secundaria | OpenAI (fallback)                                            |
| Servicios     | Gamma API (slides), Google Search (grounding)                |

### Estructura de Directorios

```
courseforge/
├── apps/
│   ├── web/                        # Frontend Next.js (App Router) + API routes
│   │   ├── netlify/functions/      # Background jobs de IA
│   │   └── src/
│   │       ├── app/
│   │       │   ├── admin/          # Dashboard administrativo
│   │       │   ├── api/            # API routes (auth, lia, publish...)
│   │       │   ├── login/          # Autenticación
│   │       │   └── dashboard/      # Vista de usuario
│   │       ├── domains/            # Lógica de negocio (syllabus, plan, curation, materials, scorm)
│   │       ├── lib/                # Servicios Lia (dom-mapper, app-context, db-context)
│   │       ├── utils/auth/         # Auth Bridge (session.ts)
│   │       └── core/              # Stores Zustand + context
│   └── api/                        # Backend Express (auth auxiliar)
├── packages/
│   ├── shared/                     # Tipos TypeScript compartidos
│   └── ui/                         # Componentes UI reutilizables
└── supabase/
    └── migrations/                 # Migraciones SQL
```

---

## Autenticación - Auth Bridge

CourseForge implementa un sistema de autenticación personalizado que valida credenciales contra la BD de **SofLIA** y emite JWTs propios (HS256).

### Flujo de Login

1. Usuario envía `identifier` + `password` desde `/login`
2. API valida contra BD de SofLIA (tabla `users`, campo `password_hash` con `bcryptjs`)
3. Se obtienen las organizaciones del usuario (`organization_users`)
4. Se firma un JWT HS256 con `COURSEFORGE_JWT_SECRET` usando `jose`
5. JWT payload: `sub`, `email`, `app_metadata.organizations`, `user_metadata`
6. Se establecen cookies: `cf_access_token`, `cf_active_org`, `cf_user_orgs`, `cf_remember_me`
7. Se registra `login_history` y se hace upsert del perfil en CourseForge

### Multi-tenancy

- Usuario puede pertenecer a múltiples organizaciones
- `cf_active_org` cookie indica la organización activa
- Artefactos filtrados por `organization_id`
- Migración automática de cuentas legacy al ID de SofLIA

### Archivos Clave

| Archivo                          | Función                                  |
| -------------------------------- | ---------------------------------------- |
| `app/api/auth/login/route.ts`    | Emisión del JWT + cookies                |
| `app/api/auth/callback/route.ts` | OAuth callback GoTrue                    |
| `app/login/actions.ts`           | Server action del formulario             |
| `utils/auth/session.ts`          | `getAuthBridgeUser()` - verificación JWT |
| `app/admin/layout.tsx`           | Guard de autenticación                   |

---

## El Pipeline de Creación (6 Fases)

Cada curso pasa por una secuencia estricta de 6 fases procesadas por Netlify Functions en background.

```
Idea → [F1] Base → [F2] Syllabus → [F3] Plan Instruccional
     → [F4] Curación → [F5] Materiales → [F6] Producción Visual
```

### Fase 1: Artefacto y Concepto

**Objetivo**: Transformar una intención vaga en una ficha técnica sólida.

**Proceso** (`generate-artifact-background.ts`):

1. Analiza la intención del usuario con Gemini + Google Search grounding
2. Genera 3-5 variantes de títulos comerciales
3. Define público objetivo y prerrequisitos
4. Redacta objetivos de aprendizaje usando verbos de la Taxonomía de Bloom

**Salida**: Artefacto con `objetivos[]`, `nombres[]`, `generation_metadata`
**Estado**: `GENERATING` → `STEP_APPROVED`

---

### Fase 2: Syllabus y Estructura

**Objetivo**: Crear el esqueleto jerárquico del curso.

**Proceso** (`syllabus-generation-background.ts`):

- Genera estructura JSON de módulos y lecciones (3-10 módulos, 2-5 lecciones c/u)
- Valida cobertura de niveles Bloom
- Selecciona ruta: `A_WITH_SOURCE` (fuentes externas) o `B_NO_SOURCE` (solo IA)

**Estado**: `STEP_READY_FOR_QA` (requiere aprobación manual)

---

### Fase 3: Planificación Instruccional

**Objetivo**: Decidir CÓMO enseñar cada tema.

**Proceso** (`instructional-plan-background.ts`):
Por cada lección asigna componentes según complejidad:

| Componente          | Cuándo usarlo                                      |
| ------------------- | -------------------------------------------------- |
| `DIALOGUE`          | Conversación guiada entre Lia y estudiante         |
| `READING`           | Concepto teórico con puntos clave                  |
| `QUIZ`              | Verificación de comprensión (multiple choice, V/F) |
| `DEMO_GUIDE`        | Proceso paso a paso con screenshots                |
| `EXERCISE`          | Tarea práctica con resultado esperado              |
| `VIDEO_THEORETICAL` | Explicación teórica en video                       |
| `VIDEO_DEMO`        | Demostración en video                              |
| `VIDEO_GUIDE`       | Video guía interactivo                             |

**Estado**: `STEP_APPROVED` o `STEP_WITH_BLOCKERS`

---

### Fase 4: Curaduría e Investigación Deep

**Objetivo**: Encontrar fuentes reales. **Esta es la fase más crítica.**

**Proceso** (`unified-curation-logic.ts`):

1. Batch processing: 2 lecciones por vez (5s delay entre batches)
2. Google Grounding en Gemini para encontrar URLs candidatas
3. Validación exhaustiva de cada URL:
   - Check de conectividad (HEAD/GET)
   - Detección de "soft 404" (200 pero con "Page not found")
   - Detección de paywalls ("Subscribe to read")
   - Longitud mínima: 500+ caracteres de contenido educativo
   - Blacklist: Reddit, Twitter, Facebook, TikTok, Quora, etc.

**QA Manual**: Admin revisa y aprueba/rechaza cada fuente
**Estado**: `PHASE2_READY_FOR_QA`

---

### Fase 5: Generación de Materiales

**Objetivo**: Redacción final usando las fuentes validadas.

**Proceso** (`materials-generation-background.ts`):

- Patrón "Daisy Chain" recursivo para manejar timeouts de Netlify
- Cascade de modelos: Gemini 3-flash → Gemini 2.0-flash → 1.5-pro
- Prompt masivo con: perfil del experto + OA exacto + contenido de fuentes curadas

| Componente | Genera                                           |
| ---------- | ------------------------------------------------ |
| DIALOGUE   | Escenas con emociones, preguntas, reflexiones    |
| READING    | Artículo HTML con secciones y tiempo de lectura  |
| QUIZ       | Preguntas con explicaciones y nivel Bloom        |
| VIDEO\_\*  | Script con timecodes, storyboard, B-roll prompts |
| DEMO_GUIDE | Pasos, screenshots, tips, warnings, video script |
| EXERCISE   | Descripción, instrucciones, resultados esperados |

**Estado**: `PHASE3_READY_FOR_QA`

---

### Fase 6: Producción Visual

**Objetivo**: Preparar activos multimedia.

**B-Roll Prompts** (`video-prompts-generation.ts`):

- Descripciones detalladas de secuencias visuales con timecodes
- Ejemplo: "0:05-0:10: Mostrar escritorio con IDE Python, usuario escribiendo código"

**Integración Gamma**:

- Genera estructura de slides (exportables a Gamma.app)
- `gamma_deck_id`, `slides_url`, `png_export_path`

**Estados**: `PENDING` → `IN_PROGRESS` → `DECK_READY` → `EXPORTED` → `COMPLETED`

---

## Lia - Asistente IA

Lia es el asistente IA integrado en toda la aplicación (`POST /api/lia`).

### Modo Conversacional

- Gemini `gemini-2.0-flash` + Google Search grounding
- Temperatura 0.7 — responde en markdown con fuentes citadas

### Modo Computer Use (Agéntico)

- Recibe screenshot + mensaje del usuario
- `lia-dom-mapper.ts` escanea el DOM, detecta elementos interactivos y coordenadas
- `gemini-2.0-flash-exp`, temperatura 0.3
- Responde con `{ message, action/actions, requiresFollowUp }`
- Ejecuta en el navegador: `click_at`, `type_at`, `scroll`, `key_press`

**Detección de alucinaciones**: Si el elemento no existe en el DOM, usa automáticamente la barra de búsqueda o hace scroll para encontrarlo.

---

## Publicación a SofLIA

Los cursos se publican a SofLIA desde `/admin/artifacts/[id]/publish`.

### Vista de Publicación (`PublicationClientView.tsx`)

**Video Mapping** (`VideoMappingList.tsx`):

- Asigna URL de video a cada lección
- Detección automática de proveedor (YouTube, Vimeo, MP4) via regex
- Sincronización de duración (cliente para MP4, API para YouTube/Vimeo)
- Checkboxes con estado indeterminado por módulo
- Publicación parcial: solo lecciones con video asignado

**Metadata del curso** (`CourseDataForm.tsx`):

- Slug, categoría, nivel, instructor, precio, thumbnail

**Tracking**: Flag `upstream_dirty` se activa si el artefacto cambia después de guardar el draft

**Estados**: `DRAFT` → `READY` → `SENT`

### API de Publicación

| Ruta                   | Descripción                                      |
| ---------------------- | ------------------------------------------------ |
| `POST /api/save-draft` | Guarda/actualiza draft en `publication_requests` |
| `POST /api/publish`    | Deposita curso en `courseengine_inbox` de SofLIA |

---

## SCORM Import

Importa cursos existentes en formato SCORM y los transforma al formato CourseForge.

**Flujo**:

1. Upload del `.zip` desde `/admin/artifacts/new`
2. `POST /api/admin/scorm/upload` — Extrae y almacena el paquete
3. `POST /api/admin/scorm/process` — Parsea y enriquece con IA
4. Crea artefacto + syllabus prellenado desde la estructura SCORM

---

## Admin Dashboard

| Ruta                            | Descripción                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `/admin`                        | Dashboard con stats y actividad reciente                     |
| `/admin/artifacts`              | Lista de cursos, crear nuevo (scratch o SCORM)               |
| `/admin/artifacts/[id]`         | Detalle del curso por fases                                  |
| `/admin/artifacts/[id]/publish` | Video mapping + publicación a SofLIA                         |
| `/admin/users`                  | Gestión de usuarios y roles (ADMIN, ARQUITECTO, CONSTRUCTOR) |
| `/admin/library`                | Materiales por lección/componente                            |
| `/admin/settings`               | Configuración de modelos IA (temperatura, thinking budget)   |
| `/admin/profile`                | Perfil del usuario admin                                     |

---

## Modelo de Datos

### Tablas Principales

| Tabla                  | Contenido                                                       |
| ---------------------- | --------------------------------------------------------------- |
| `artifacts`            | Cursos: idea, objetivos, state, organization_id                 |
| `profiles`             | Usuarios con `platform_role` (ADMIN, ARQUITECTO, CONSTRUCTOR)   |
| `syllabus`             | Estructura de módulos y lecciones (JSONB)                       |
| `instructional_plans`  | Componentes por lección + DoD checks                            |
| `curation_rows`        | Fuentes: URL, validación, http_status, aptness                  |
| `material_components`  | Contenido generado + assets de producción                       |
| `publication_requests` | Drafts: lesson_videos JSONB, selected_lessons[], upstream_dirty |
| `login_history`        | Auditoría de logins (IP, user agent, timestamp)                 |
| `model_settings`       | Config de modelos IA por tipo                                   |
| `pipeline_events`      | Log del pipeline                                                |
| `scorm_packages`       | Paquetes SCORM importados                                       |
| `scorm_lessons`        | Lecciones parseadas de SCORM                                    |

### Detalle de tablas clave

**`artifacts`**: `id` (uuid PK), `idea_central` (text), `state` (enum), `nombres` (jsonb), `objetivos` (jsonb), `organization_id` (uuid)

**`instructional_plans`**: `lesson_plans` (jsonb — array masivo con definición de cada lección), `dod` (jsonb — Definition of Done), `blockers` (jsonb)

**`curation_rows`**: `lesson_id` (text), `source_ref` (text URL), `apta` (boolean), `url_status` (text), `http_status_code` (int)

**`publication_requests`**: `artifact_id`, `lesson_videos` (jsonb — map lessonId→videoUrl), `selected_lessons` (text[]), `upstream_dirty` (boolean)

---

## API Routes

### Autenticación

| Ruta                 | Método | Descripción                      |
| -------------------- | ------ | -------------------------------- |
| `/api/auth/login`    | POST   | Login Auth Bridge (SofLIA → JWT) |
| `/api/auth/sign-up`  | POST   | Registro                         |
| `/api/auth/callback` | GET    | OAuth callback GoTrue            |

### IA y Generación

| Ruta            | Método | Descripción                                  |
| --------------- | ------ | -------------------------------------------- |
| `/api/lia`      | POST   | Chat con Lia (conversacional o Computer Use) |
| `/api/syllabus` | POST   | Iniciar generación de syllabus               |

### Admin

| Ruta                       | Método | Descripción                       |
| -------------------------- | ------ | --------------------------------- |
| `/api/admin/users`         | POST   | Crear/actualizar perfiles con rol |
| `/api/admin/scorm/upload`  | POST   | Subir paquete SCORM               |
| `/api/admin/scorm/process` | POST   | Procesar SCORM con IA             |

### Publicación

| Ruta              | Método | Descripción                              |
| ----------------- | ------ | ---------------------------------------- |
| `/api/publish`    | POST   | Publicar a SofLIA (`courseengine_inbox`) |
| `/api/save-draft` | POST   | Guardar draft de publicación             |

### Netlify Functions (Background Jobs)

| Función                           | Fase  | Descripción                                  |
| --------------------------------- | ----- | -------------------------------------------- |
| `generate-artifact-background`    | F1    | Research + objetivos + títulos               |
| `syllabus-generation-background`  | F2    | Estructura módulos y lecciones               |
| `instructional-plan-background`   | F3    | Componentes por lección                      |
| `validate-plan-background`        | F3 QA | Validación del plan                          |
| `curation-background`             | F4    | Búsqueda y validación de fuentes             |
| `validate-curation-background`    | F4 QA | Revisión manual de fuentes                   |
| `materials-generation-background` | F5    | Generación de contenido                      |
| `validate-materials-background`   | F5 QA | Validación de materiales                     |
| `video-prompts-generation`        | F6    | B-roll prompts                               |
| `auth-sync`                       | —     | Sincronización de usuarios entre plataformas |

---

## Guía de Desarrollo

### Requisitos

- Node.js 20+
- Cuenta en Supabase (CourseForge)
- Acceso a Supabase de SofLIA
- API Key de Google AI Studio (Gemini)

### Instalación

```bash
# 1. Clonar repositorio
git clone [repo-url]

# 2. Instalar dependencias (desde raíz del monorepo)
npm install

# 3. Variables de entorno
cp .env.example .env
# Completar todas las variables requeridas
```

### Variables de Entorno

```env
# Supabase (CourseForge)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth Bridge
COURSEFORGE_JWT_SECRET=          # Secreto HS256 para firmar JWTs

# SofLIA (plataforma externa)
SOFLIA_INBOX_SUPABASE_URL=
SOFLIA_INBOX_SUPABASE_KEY=

# Gemini AI
GOOGLE_GENERATIVE_AI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_SEARCH_MODEL=gemini-2.0-flash

# OpenAI (fallback)
OPENAI_API_KEY=

# Gamma (slides)
GAMMA_API_KEY=
```

### Desarrollo Local

```bash
# Inicia Frontend (:3000) y Backend (:4000) simultáneamente
npm run dev
```

### Debugging

Los logs del backend usan prefijos identificables:

- `[Lesson Curation]` — Fase 4
- `[Mat IDs-xyz]` — Fase 5
- `✓` éxito, `✗` fallo de validación

Los errores actualizan el estado en BD a `NEEDS_FIX` o `ERROR` (no hay spinners infinitos).

### Patrones de Código

- **Path aliases**: `@/*`, `@/features/*`, `@/shared/*`, `@/core/*`
- **Componentes cliente**: `"use client"` al inicio del archivo
- **Estilos condicionales**: `cn()` helper de TailwindCSS
- **Dark mode**: `darkMode: "class"` en Tailwind
- **Validación de schemas**: Zod
- **JWT**: `jose` library (compatible con Edge runtime, no `jsonwebtoken`)
- **Passwords**: `bcryptjs` (sin bindings nativos, compatible con Netlify)

---

**CourseForge** — _Ingeniería Educativa Automatizada_
