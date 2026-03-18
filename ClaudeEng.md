# CourseEngine

Plataforma de creación de cursos automatizada con IA. Transforma una idea en un curso completo con curriculum, planes de lección, fuentes curadas, materiales educativos y producción de video. Se integra con **SofLIA** como plataforma receptora de cursos publicados.

## Stack

- **Frontend**: Next.js 16, React 19, TypeScript, TailwindCSS 4.x, Zustand, Framer Motion
- **Backend**: Express + Netlify Functions (background jobs)
- **DB/Auth**: Supabase (PostgreSQL) + Auth Bridge JWT (HS256, `jose`)
- **IA**: Google Gemini (primario), OpenAI (secundario)
- **Servicios**: Gamma API (slides), Google Search (grounding)
- **Utilidades**: `bcryptjs` (hash), `jose` (JWT), Zod (validación)

## Comandos

```bash
npm install          # Instalar dependencias
npm run dev          # Frontend :3000 + Backend :4000
npm run build        # Build producción
```

---

## Autenticación - Auth Bridge (Opción C)

CourseEngine usa un sistema JWT personalizado que actúa de puente entre **SofLIA** (plataforma externa) y CourseEngine.

### Flujo de Login

1. Usuario envía `identifier` (email/username) + `password`
2. Se valida contra la BD de **SofLIA** (`users.password_hash` con `bcryptjs`)
3. Se obtienen las organizaciones del usuario (`organization_users`)
4. Se firma un JWT HS256 con `COURSEENGINE_JWT_SECRET` (via `jose`)
5. JWT contiene: `sub`, `email`, `app_metadata.organizations`, `user_metadata`
6. Se crean cookies: `cf_access_token`, `cf_active_org`, `cf_user_orgs`, `cf_remember_me`
7. Se registra `login_history` en CourseEngine
8. Se hace upsert del `profiles` del usuario en CourseEngine
9. Si hay cuenta legacy, se migra automáticamente al ID de SofLIA

### Verificación de Sesión

- `getAuthBridgeUser()` en `utils/auth/session.ts` lee cookie `cf_access_token`
- Verifica firma JWT y retorna payload con metadata
- Fallback a Supabase GoTrue si no hay token Auth Bridge

### Multi-tenancy

- Usuario puede pertenecer a múltiples organizaciones
- `cf_active_org` indica la organización activa
- Los artefactos se filtran por `organization_id`

### Archivos Clave de Auth

| Archivo                          | Función                                  |
| -------------------------------- | ---------------------------------------- |
| `app/api/auth/login/route.ts`    | Login + firma JWT + cookies              |
| `app/api/auth/callback/route.ts` | OAuth callback GoTrue                    |
| `app/login/actions.ts`           | Server action del formulario de login    |
| `app/login/page.tsx`             | Página de login                          |
| `utils/auth/session.ts`          | `getAuthBridgeUser()` - verificación JWT |
| `app/admin/layout.tsx`           | Verifica auth (GoTrue O Auth Bridge)     |

---

## SofLIA - Asistente IA

SofLIA es la asistente IA integrada en toda la app.

### Modo Conversacional

- Usuario envía mensaje de texto
- Llama a `/api/lia` con Gemini + Google Search grounding
- Modelo: `gemini-2.0-flash`, temperatura 0.7
- Responde en markdown con fuentes citadas

### Servicios de SofLIA

| Archivo              | Función                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `lia-app-context.ts` | Prompts del sistema y contexto de la app (páginas, menús, comportamiento)  |
| `lia-db-context.ts`  | Obtiene contexto de Supabase (usuario, artefactos recientes, estadísticas) |

---

## Pipeline de Creación de Cursos (6 Fases)

### Fase 1: BASE - Idea Central

**Entrada**: Título, descripción, público objetivo, resultados esperados

**Proceso** (`generate-artifact-background.ts`):

1. **Research**: Gemini + Google Search investiga el tema (tendencias, herramientas, prácticas)
2. **Objetivos**: Extrae 5-7 objetivos de aprendizaje usando taxonomía de Bloom
3. **Nombres**: Genera 3-5 títulos alternativos para el curso

**Salida**: Artefacto con `objetivos[]`, `nombres[]`, `generation_metadata`

**Estado**: `GENERATING` → `STEP_APPROVED`

---

### Fase 2: SYLLABUS - Estructura

**Entrada**: Idea central + objetivos de aprendizaje

**Proceso** (`syllabus-generation-background.ts`):

1. Genera estructura JSON de módulos y lecciones
2. Valida: 3-10 módulos, 2-5 lecciones por módulo, cobertura de niveles Bloom
3. Selecciona ruta: `A_WITH_SOURCE` (fuentes externas) o `B_NO_SOURCE` (solo IA)

**Salida**:

```json
{
  "modules": [
    {
      "id": "mod-1",
      "title": "Nombre del módulo",
      "lessons": [
        {
          "id": "les-1-1",
          "title": "Título de lección",
          "objective_specific": "Qué aprende el estudiante"
        }
      ]
    }
  ]
}
```

**Estado**: `STEP_READY_FOR_QA` (requiere aprobación manual)

---

### Fase 3: PLAN INSTRUCCIONAL - Diseño de Aprendizaje

**Entrada**: Syllabus + objetivos

**Proceso** (`instructional-plan-background.ts`):
Para cada lección genera:

- `oa_text`: Resultado de aprendizaje
- `oa_bloom_verb`: Nivel Bloom (comprender, aplicar, analizar, evaluar, crear)
- `measurable_criteria`: Criterios medibles
- `components[]`: Componentes de la lección

**Tipos de Componentes**:
| Tipo | Descripción |
|------|-------------|
| `DIALOGUE` | Conversación entre Lia y estudiante |
| `READING` | Artículo con puntos clave |
| `QUIZ` | Preguntas de evaluación |
| `DEMO_GUIDE` | Guía paso a paso con screenshots |
| `EXERCISE` | Tarea práctica |
| `VIDEO_THEORETICAL` | Video teórico con script |
| `VIDEO_DEMO` | Video demostración |
| `VIDEO_GUIDE` | Video guía |

**Estado**: `STEP_APPROVED` o `STEP_WITH_BLOCKERS`

---

### Fase 4: CURACIÓN - Búsqueda de Fuentes

**Entrada**: Plan instruccional con componentes

**Proceso** (`unified-curation-logic.ts`):

1. Para cada componente, genera queries de búsqueda específicos
2. Busca en Google fuentes confiables (.edu, docs oficiales, publicaciones)
3. Valida cada URL:
   - HTTP status OK
   - No soft 404
   - No paywall
   - 500+ caracteres de contenido educativo
   - No spam/duplicados
4. Procesa en batches de 2 lecciones (5s delay entre batches)

**Almacena en `curation_rows`**:

- URL, título, justificación
- Estado de validación (apta, cobertura_completa)
- Código HTTP, última verificación

**QA Manual**: Admin revisa y marca fuentes como "Aprobado" o "No Apto"

**Estado**: `PHASE2_READY_FOR_QA`

---

### Fase 5: MATERIALES - Generación de Contenido

**Entrada**: Plan + fuentes curadas

**Proceso** (`materials-generation-background.ts`):

| Componente | Genera                                                              |
| ---------- | ------------------------------------------------------------------- |
| DIALOGUE   | Escenas con emociones, preguntas, reflexiones                       |
| READING    | Artículo HTML con secciones, tiempo de lectura, preguntas           |
| QUIZ       | Multiple choice, V/F, completar. Con explicaciones y nivel Bloom    |
| VIDEO\_\*  | Script con timecodes, storyboard, texto en pantalla, B-roll prompts |
| DEMO_GUIDE | Pasos, screenshots, tips, warnings, video script                    |
| EXERCISE   | Descripción, instrucciones, resultados esperados, dificultad        |

**Validación**:

- Todos los componentes generados
- Consistencia con fuentes
- Cobertura de quiz
- Formato correcto

**Estado**: `PHASE3_READY_FOR_QA`

---

### Fase 6: PRODUCCIÓN VISUAL - Video y Slides

**Entrada**: Storyboards de componentes de video

**B-Roll Prompts** (`video-prompts-generation.ts`):

- Genera descripciones detalladas de secuencias visuales
- Timing, elementos visuales, texto en pantalla, notas de narración
- Ejemplo: "0:05-0:10: Mostrar escritorio con IDE Python, usuario escribiendo código"

**Integración Gamma**:

- `gamma_deck_id`: ID único del deck
- `slides_url`: Link a presentación Gamma
- `png_export_path`: Slides exportados

**Estados de Producción**:
`PENDING` → `IN_PROGRESS` → `DECK_READY` → `EXPORTED` → `COMPLETED`

**DoD Checklist**: has_slides_url, has_video_url, has_screencast_url, has_b_roll_prompts, has_final_video_url

---

## Publicación de Cursos en SofLIA

El flujo de publicación transforma un artefacto CourseEngine al schema de SofLIA y lo deposita en `courseengine_inbox`.

### Vista de Publicación (`/admin/artifacts/[id]/publish`)

**Componentes**:

- `PublicationClientView.tsx` - Orquesta toda la vista
- `VideoMappingList.tsx` - Lista de lecciones con asignación de videos:
  - Checkboxes con estado indeterminado por módulo
  - Detección automática de proveedor (YouTube, Vimeo, MP4 directo) vía regex
  - Sincronización de duración (cliente para MP4, servidor para YT/Vimeo)
  - Selección parcial: solo publicar lecciones con video asignado
- `CourseDataForm.tsx` - Metadata del curso (slug, categoría, nivel, instructor, precio, thumbnail)

**Estados de Publication Request**: `DRAFT` → `READY` → `SENT`

**Tracking de cambios**: Flag `upstream_dirty` se activa si el artefacto cambia después de guardar el draft

### API Routes de Publicación

| Ruta                   | Método | Descripción                                      |
| ---------------------- | ------ | ------------------------------------------------ |
| `/api/publish`         | POST   | Publica curso a `courseengine_inbox` de SofLIA   |
| `/api/save-draft`      | POST   | Guarda/actualiza draft en `publication_requests` |
| `/api/trigger-publish` | POST   | Webhook alternativo para trigger                 |
| `/api/test-publish`    | POST   | Endpoint de debug para pruebas                   |

---

## SCORM Import

Permite importar cursos SCORM existentes y transformarlos al formato CourseEngine.

### Flujo

1. Upload del archivo SCORM (`.zip`) desde `/admin/artifacts/new`
2. POST `/api/admin/scorm/upload` - Almacena y extrae el paquete
3. POST `/api/admin/scorm/process` - Parsea y enriquece el contenido con IA
4. Crea artefacto + syllabus prellenado desde la estructura SCORM

### Tablas

- `scorm_packages` - Metadata del paquete SCORM
- `scorm_lessons` - Estructura de lecciones parseadas

---

## API Routes

### Autenticación

- `POST /api/auth/login` - Login con Auth Bridge (SofLIA credentials → JWT)
- `POST /api/auth/sign-up` - Registro
- `GET /api/auth/callback` - OAuth callback GoTrue

### SofLIA

- `POST /api/lia` - Chat con SofLIA (ambos modos)

### Syllabus

- `POST /api/syllabus` - Inicia generación de syllabus

### Admin

- `POST /api/admin/users` - Crear/actualizar perfiles con roles
- `POST /api/admin/scorm/upload` - Subir paquete SCORM
- `POST /api/admin/scorm/process` - Procesar SCORM con IA

### Publicación

- `POST /api/publish` - Publicar a SofLIA inbox
- `POST /api/save-draft` - Guardar draft de publicación

### Netlify Functions (Background)

| Función                           | Descripción                                  |
| --------------------------------- | -------------------------------------------- |
| `generate-artifact-background`    | Fase 1 completa                              |
| `syllabus-generation-background`  | Fase 2                                       |
| `instructional-plan-background`   | Fase 3                                       |
| `validate-plan-background`        | Validación Fase 3                            |
| `curation-background`             | Fase 4                                       |
| `validate-curation-background`    | Validación Fase 4                            |
| `materials-generation-background` | Fase 5                                       |
| `validate-materials-background`   | Validación Fase 5                            |
| `video-prompts-generation`        | B-roll prompts Fase 6                        |
| `auth-sync`                       | Sincronización de usuarios entre plataformas |

---

## Admin Dashboard

### `/admin` - Dashboard Principal

- Stats: usuarios totales, artefactos activos, en pipeline
- Actividad reciente y quick actions

### `/admin/artifacts`

- Lista de cursos con estados (DRAFT, GENERATING, VALIDATING, READY_FOR_QA, APPROVED, REJECTED)
- Crear nuevo artefacto (desde cero o importar SCORM)
- Ver detalle → navegar por fases
- Aprobar/rechazar fases con notas
- Regenerar con feedback

### `/admin/artifacts/[id]/publish`

- Vista de publicación con video mapping
- Selección de lecciones a publicar
- Metadata del curso (slug, nivel, precio, etc.)
- Guardar draft / Publicar a SofLIA

### `/admin/library`

- Buscar materiales por lección/componente
- Editar contenido
- Marcar para revisión

### `/admin/settings`

- Configurar modelos IA (LIA_MODEL, COMPUTER)
- Temperatura, thinking budget
- Activar/desactivar configuraciones

### `/admin/users`

- Gestión de usuarios y roles (ADMIN, ARQUITECTO, CONSTRUCTOR)
- Crear/editar perfiles
- Asignar roles via modal

### `/admin/profile`

- Perfil personal del usuario admin

---

## Base de Datos (Tablas Principales)

| Tabla                  | Contenido                                                                     |
| ---------------------- | ----------------------------------------------------------------------------- |
| `artifacts`            | Curso base: idea_central, objetivos[], nombres[], state, organization_id      |
| `profiles`             | Perfiles de usuario: platform_role (ADMIN, ARQUITECTO, CONSTRUCTOR)           |
| `syllabus`             | Estructura: modules (JSONB), route, validation                                |
| `instructional_plans`  | Planes: lesson_plans[], blockers, dod                                         |
| `curation`             | Estado de curación, qa_decision                                               |
| `curation_rows`        | Fuentes: URL, validación, aptness                                             |
| `materials`            | Estado global de materiales                                                   |
| `material_lessons`     | Componentes por lección                                                       |
| `material_components`  | Contenido + assets (slides, b_roll, production_status)                        |
| `publication_requests` | Draft de publicación: lesson_videos JSONB, selected_lessons[], upstream_dirty |
| `login_history`        | Auditoría de logins (IP, user agent, timestamp)                               |
| `model_settings`       | Configuración de modelos IA                                                   |
| `pipeline_events`      | Log de eventos del pipeline                                                   |
| `scorm_packages`       | Metadata de paquetes SCORM importados                                         |
| `scorm_lessons`        | Estructura de lecciones parseadas de SCORM                                    |

---

## Estructura del Proyecto

```
apps/
├── web/src/
│   ├── app/
│   │   ├── admin/                  # Dashboard admin
│   │   │   ├── page.tsx            # Dashboard con stats
│   │   │   ├── layout.tsx          # Auth check (GoTrue o Auth Bridge)
│   │   │   ├── AdminLayoutClient.tsx # Sidebar, dark mode, menú
│   │   │   ├── artifacts/          # CRUD de cursos + publicación
│   │   │   ├── users/              # Gestión de usuarios
│   │   │   ├── library/            # Materiales
│   │   │   ├── settings/           # Configuración IA
│   │   │   └── profile/            # Perfil admin
│   │   ├── api/                    # API routes
│   │   │   ├── auth/               # Login, callback, sign-up
│   │   │   ├── lia/                # Chat + Computer Use
│   │   │   ├── admin/              # users, scorm
│   │   │   ├── publish/            # Publicación a SofLIA
│   │   │   └── save-draft/         # Draft de publicación
│   │   ├── login/                  # Página de login
│   │   └── dashboard/              # Dashboard usuario
│   ├── components/lia/             # LiaChat component
│   ├── lib/                        # Servicios SofLIA (service, app-context, db-context, dom-mapper)
│   ├── domains/                    # Lógica de negocio (syllabus, plan, curation, materials, scorm)
│   ├── utils/
│   │   ├── supabase/               # Clientes Supabase
│   │   └── auth/                   # session.ts (Auth Bridge)
│   ├── core/                       # Stores Zustand + context
│   └── config/                     # Configuración global
├── api/src/                        # Backend Express
│   └── features/auth/              # Módulo auth Express
packages/
├── shared/                         # Tipos compartidos
└── ui/                             # Componentes UI
supabase/
└── migrations/                     # Migraciones DB
netlify/functions/                  # Background jobs
```

---

## Variables de Entorno

```env
# Supabase (CourseEngine)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth Bridge
COURSEENGINE_JWT_SECRET=          # Secreto HS256 para firmar JWTs

# SofLIA (plataforma externa receptora)
SOFLIA_INBOX_SUPABASE_URL=       # BD de SofLIA (para publicar cursos)
SOFLIA_INBOX_SUPABASE_KEY=       # Service role key de SofLIA

# Gemini
GOOGLE_GENERATIVE_AI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_SEARCH_MODEL=gemini-2.0-flash

# OpenAI (fallback)
OPENAI_API_KEY=

# Fuentes secundarias
GPT_SOURCES_API_KEY=

# Gamma
GAMMA_API_KEY=
```

---

## Patrones Importantes

- **Path aliases**: `@/*`, `@/features/*`, `@/shared/*`, `@/core/*`
- **Estado**: Zustand para global, Supabase para persistente
- **Estilos**: TailwindCSS 4.x + `cn()` para clases condicionales
- **Dark mode**: `darkMode: "class"` en Tailwind
- **Validación**: Zod para schemas
- **Componentes cliente**: `"use client"` al inicio
- **Animaciones**: Framer Motion para transiciones y micro-interacciones
- **JWT**: `jose` library (no `jsonwebtoken`) para compatibilidad con Edge runtime
- **Passwords**: `bcryptjs` (no `bcrypt`) para compatibilidad con Node sin bindings nativos
