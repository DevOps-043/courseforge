# 📘 CourseEngine - Plataforma de Ingeniería Instruccional con IA

> **Versión**: 1.0.0
> **Estado**: Producción (Beta)
> **Stack**: Next.js 16, Supabase, Netlify Functions, Google Gemini 2.0

CourseEngine es mucho más que un "generador de cursos". Es un **Sistema Operativo de Diseño Instruccional** que orquesta múltiples agentes de IA para investigar, estructurar, redactar y validar contenido educativo de alta calidad.

El sistema simula el flujo de trabajo de un equipo humano (Investigador + Diseñador Instruccional + Redactor + Editor), donde la salida de cada fase es rigurosamente validada antes de ser utilizada como entrada para la siguiente.

---

## 📑 Tabla de Contenidos

1. [Filosofía del Sistema](#-filosofía-del-sistema)
2. [Arquitectura Técnica](#-arquitectura-técnica)
3. [El Pipeline "Lia" (Paso a Paso)](#-el-pipeline-lia)
   - [Fase 1: Artefacto y Concepto](#fase-1-artefacto-y-concepto)
   - [Fase 2: Syllabus y Estructura](#fase-2-syllabus-y-estructura)
   - [Fase 3: Planificación Instruccional](#fase-3-planificación-instruccional)
   - [Fase 4: Curaduría e Investigación Deep](#fase-4-curaduría-e-investigación-deep)
   - [Fase 5: Generación de Materiales](#fase-5-generación-de-materiales)
   - [Fase 6: Producción Visual](#fase-6-producción-visual)
4. [Modelo de Datos (Supabase)](#-modelo-de-datos)
5. [Lógica de Backend y Background Jobs](#-lógica-de-backend)
6. [Guía de Desarrollo](#-guía-de-desarrollo)

---

## 🧠 Filosofía del Sistema

CourseEngine se basa en tres principios no negociables:
CourseEngine se basa en tres principios no negociables:

1.  **NO A LA ALUCINACIÓN**: A diferencia de ChatGPT, CourseEngine _no inventa_ hechos. Utiliza un motor de curaduría (Fase 4) que busca referencias reales, verifica que las URLs funcionen (HTTP 200) y valida que el contenido sea relevante antes de usarlo para escribir.
2.  **ESTRUCTURA PRIMERO, CONTENIDO DESPUÉS**: No se genera texto hasta que no haya un plan instruccional aprobado (Fase 3). Esto asegura coherencia pedagógica.
3.  **HUMAN-IN-THE-LOOP (HITL)**: El sistema está diseñado para detenerse entre fases críticas, permitiendo que un experto humano revise y apruebe el syllabus o las fuentes antes de continuar.

---

## 🏗 Arquitectura Técnica

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

```bash
courseengine/
├── apps/
│   ├── web/                    # Frontend Next.js 16 (App Router)
│   │   ├── netlify/functions/  # Backend Serverless (donde ocurre la magia)
│   │   ├── src/
│   │   │   ├── app/            # Rutas principales de la aplicación
│   │   │   │   ├── builder/    # Área principal de creación de artefactos
│   │   │   │   ├── admin/      # Configuración centralizada y gestión de usuarios
│   │   │   │   └── api/        # Rutas de API internas
│   │   │   ├── domains/        # Lógica de negocio encapsulada
│   │   │   │   ├── curation/   # Componentes y hooks de curaduría
│   │   │   │   ├── materials/  # Componentes de iteración de materiales
│   │   │   │   └── ...
│   │   │   └── core/           # Servicios base (Supabase, API Client, componentes Agnósticos)
│   └── api/                    # API Express (Legacy/Auxiliar)
├── packages/
│   ├── shared/                 # Tipos TypeScript compartidos y utilidades
│   └── ui/                     # Librería de componentes visuales compartidos
└── supabase/                   # Migraciones y Seeds SQL
```

---

## Autenticación - Auth Bridge

CourseEngine implementa un sistema de autenticación personalizado que valida credenciales contra la BD de **SofLIA** y emite JWTs propios (HS256).

### Flujo de Login

1. Usuario envía `identifier` + `password` desde `/login`
2. API valida contra BD de SofLIA (tabla `users`, campo `password_hash` con `bcryptjs`)
3. Se obtienen las organizaciones del usuario (`organization_users`)
4. Se firma un JWT HS256 con `COURSEENGINE_JWT_SECRET` usando `jose`
5. JWT payload: `sub`, `email`, `app_metadata.organizations`, `user_metadata`
6. Se establecen cookies: `cf_access_token`, `cf_active_org`, `cf_user_orgs`, `cf_remember_me`
7. Se registra `login_history` y se hace upsert del perfil en CourseEngine

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

## 🔄 El Pipeline "Lia"

Cada curso pasa por una secuencia estricta de 6 fases. A continuación se detalla la lógica interna de cada una.

### Fase 1: Artefacto y Concepto

**Objetivo**: Transformar una intención vaga ("quiero un curso de ventas") en una ficha técnica sólida.

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

**Objetivo**: El "Cerebro Pedagógico". Decide CÓMO enseñar cada tema.

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

**Objetivo**: Encontrar la verdad. **Esta es la fase más compleja y crítica.**

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

**Objetivo**: Redacción final de los contenidos usando las fuentes validadas.

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

## SofLIA - Asistente IA

SofLIA es la asistente IA integrada en toda la aplicación (`POST /api/lia`).

### Modo Conversacional

- Gemini `gemini-2.0-flash` + Google Search grounding
- Temperatura 0.7 — responde en markdown con fuentes citadas

---

## Publicación a SofLIA

Los cursos se publican a SofLIA desde `/admin/artifacts/[id]/publish`.

### 1. `artifacts` (La tabla padre)

| Columna        | Tipo  | Descripción                                    |
| -------------- | ----- | ---------------------------------------------- |
| `id`           | uuid  | PK                                             |
| `user_id`      | uuid  | Referencia al creador (FK a `public.profiles`) |
| `idea_central` | text  | Input original del usuario                     |
| `state`        | enum  | Estado global (`DRAFT`, `VALIDATED`, etc.)     |
| `nombres`      | jsonb | Array de títulos sugeridos                     |

### 2. `instructional_plans`

| Columna        | Tipo  | Descripción                                    |
| -------------- | ----- | ---------------------------------------------- |
| `lesson_plans` | jsonb | Array masivo con la definición de cada lección |
| `dod`          | jsonb | Definition of Done (Checks de calidad)         |

### 3. `curation_rows` (Fuentes)

| Columna            | Tipo    | Descripción                                 |
| ------------------ | ------- | ------------------------------------------- |
| `lesson_id`        | text    | ID lógico de la lección (e.g., "mod1-les2") |
| `source_ref`       | text    | URL de la fuente                            |
| `apta`             | boolean | Si pasó la validación automática            |
| `url_status`       | text    | 'OK', 'FAILED', 'PENDING'                   |
| `http_status_code` | int     | Código real (200, 404, etc.)                |

### 4. `materials` & `material_lessons`

Relación Maestro-Detalle. `materials` trackea el estado global de la Fase 5, mientras que `material_lessons` trackea el progreso individual de cada lección para permitir el procesamiento paralelo/secuencial.

---

## 🛠 Lógica de Backend

El backend reside en `apps/web/netlify/functions`. No es una API REST tradicional, sino una colección de funciones "background" diseñadas para tareas largas.

### Patrón de Ejecución "Fire and Forget"

1. El Frontend llama a una función (e.g., `/generate-materials`).
2. La función responde `200 OK` inmediatamente ("Recibido, empezando a trabajar").
3. El proceso real continúa en segundo plano (hasta 10-15 minutos permitidos por Netlify en planes altos, o limitado a 10s en funciones estándar, por lo cual usamos el patrón de recursión en Fase 5).

### Gestión de Errores

Todas las funciones implementan bloques `try/catch` robustos que:

1. Capturan el error.
2. Lo loguean con prefijos identificables (e.g., `[Mat IDs-xyz]`).
3. Actualizan el estado en base de datos a `NEEDS_FIX` o `ERROR` para que el usuario sepa que algo falló, en lugar de quedarse en un spinner infinito.

---

## 💻 Guía de Desarrollo

### Requisitos Previos

- Node.js 20+
- Cuenta en Supabase
- API Key de Google AI Studio (Gemini)

### Instalación

```bash
# 1. Clonar repo
git clone [repo-url]

# 2. Instalar dependencias (desde raíz)
npm install

# 3. Variables de entorno
cp .env.local.example .env.local
# Rellenar: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY
```

### Ejecutar Localmente

```bash
# Inicia Frontend y Backend simultáneamente
npm run dev
```

Acceder a `http://localhost:3000`.

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

**CourseEngine** - _Ingeniería Educativa Automatizada_
