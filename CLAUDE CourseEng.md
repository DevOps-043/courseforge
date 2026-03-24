# Courseforge

Plataforma de creación de cursos automatizada con IA. Transforma una idea en un curso completo con curriculum, planes de lección, fuentes curadas, materiales educativos y producción de video. Soporta importación de SCORM y publicación directa a Soflia.

## Stack

- **Frontend**: Next.js 16, React 19, TypeScript, TailwindCSS 4, Zustand
- **Backend**: Express + Netlify Functions (background jobs)
- **DB/Auth**: Supabase (PostgreSQL) con RLS y Auth Bridge (profiles)
- **IA**: Google Gemini (primario), OpenAI (secundario)
- **Servicios**: Gamma API (slides), Google Search (grounding), Soflia API (publicación)

## Comandos

```bash
npm install          # Instalar dependencias
npm run dev          # Frontend :3000 + Backend :4000
npm run build        # Build producción
```

---

## Lia - Asistente IA

Lia es el asistente IA integrado en toda la app. Tiene dos modos:

### Modo Estándar (Conversacional)

- Usuario envía mensaje de texto
- Llama a `/api/lia` con Gemini + Google Search grounding
- Modelo: `gemini-2.0-flash`, temperatura 0.7
- Responde en markdown con fuentes citadas

### Modo Computer Use (Agéntico)

- Usuario envía mensaje + screenshot de la página actual
- `lia-dom-mapper.ts` escanea el DOM detectando elementos interactivos
- Modelo: `gemini-2.0-flash-exp`, temperatura 0.3
- Responde con JSON: `{ message, action/actions, requiresFollowUp }`
- Ejecuta acciones en el navegador (click, type, scroll, etc.)

### Servicios de Lia

| Archivo              | Función                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `lia-service.ts`     | Ejecuta acciones en el navegador (click_at, type_at, scroll, key_press) con feedback visual |
| `lia-app-context.ts` | Prompts del sistema y contexto de la app (páginas, menús, comportamiento)                   |
| `lia-db-context.ts`  | Obtiene contexto de Supabase (usuario, artefactos recientes, estadísticas)                  |
| `lia-dom-mapper.ts`  | Escanea DOM, detecta elementos interactivos, retorna coordenadas                            |

### Detección de Alucinaciones

Si Lia intenta abrir un artefacto que no existe en el DOM, automáticamente:

1. Busca en la barra de búsqueda
2. Si no encuentra, hace scroll para buscar el elemento

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

## Importación SCORM

Flujo alternativo para importar cursos existentes en formato SCORM y convertirlos al pipeline de Courseforge.

**Proceso** (domain: `domains/scorm/`):

1. **Upload**: Sube paquete `.zip` SCORM → bucket `scorm-packages`
2. **Parsing** (`scorm-parser.service.ts`): Extrae manifiesto, SCOs, recursos, HTML
3. **Análisis**: Detecta componentes, quizzes, gaps de contenido
4. **Enriquecimiento** (`scorm-enrichment.service.ts`): Gemini analiza y completa gaps
5. **Transformación** (`scorm-transformation.service.ts`): Convierte a estructura Courseforge

**Estados**: `UPLOADED` → `PARSING` → `ANALYZED` → `ENRICHING` → `TRANSFORMING` → `COMPLETED` | `FAILED`

**API**:

- `POST /api/admin/scorm/upload` - Sube y registra paquete
- `POST /api/admin/scorm/process` - Inicia procesamiento

**Tablas**: `scorm_imports`, `scorm_resources`

---

## Publicación a Soflia

Flujo para publicar un artefacto completado a la plataforma Soflia.

**Proceso** (`/admin/artifacts/[id]/publish`):

1. Admin completa datos del curso: categoría, nivel, instructor, thumbnail, slug, precio
2. Mapea videos de producción a cada lección (`VideoMappingList`)
3. Guarda borrador → `POST /api/save-draft`
4. Publica a Soflia → `POST /api/publish`

**Estados** (`publication_requests.status`):
`DRAFT` → `READY` → `SENT` → `APPROVED` | `REJECTED`

**Campos de `publication_requests`**:

- `category`, `level` (beginner|intermediate|advanced)
- `instructor_email`, `thumbnail_url`, `slug`, `price`
- `lesson_videos` (JSONB): mapeo video por lección con duración y proveedor
- `selected_lessons` (JSONB): lecciones incluidas en la publicación
- `soflia_course_id`, `soflia_response`

---

## API Routes

### Autenticación

- `POST /api/auth/login` - Login
- `POST /api/auth/sign-up` - Registro
- `GET /api/auth/callback` - OAuth callback

### Lia

- `POST /api/lia` - Chat con Lia (ambos modos)

### Syllabus

- `POST /api/syllabus` - Inicia generación de syllabus

### Publicación

- `POST /api/publish` - Publica artefacto a Soflia
- `POST /api/save-draft` - Guarda borrador de publicación

### Admin

- `POST /api/admin/users` - Gestión de usuarios
- `POST /api/admin/scorm/upload` - Sube paquete SCORM
- `POST /api/admin/scorm/process` - Procesa paquete SCORM

### Debug / GPT

- `GET /api/debug/soflia` - Debug integración Soflia
- `GET /api/gpt/sources` - Fuentes para GPT

### Netlify Functions (Background)

| Función                           | Descripción       |
| --------------------------------- | ----------------- |
| `generate-artifact-background`    | Fase 1 completa   |
| `syllabus-generation-background`  | Fase 2            |
| `instructional-plan-background`   | Fase 3            |
| `validate-plan-background`        | Validación Fase 3 |
| `unified-curation-logic`          | Fase 4            |
| `validate-curation-background`    | Validación Fase 4 |
| `materials-generation-background` | Fase 5            |
| `validate-materials-background`   | Validación Fase 5 |
| `video-prompts-generation`        | B-roll prompts    |

---

## Dashboards

El sistema tiene tres dashboards con roles diferenciados:

### Admin Dashboard (`/admin`)

- `/admin/artifacts` - Lista y gestión de artefactos
- `/admin/artifacts/new` - Crear artefacto (manual o importar SCORM)
- `/admin/artifacts/[id]` - Detalle: navegar fases, aprobar/rechazar, regenerar
- `/admin/artifacts/[id]/publish` - Publicar a Soflia (datos + video mapping)
- `/admin/library` - Buscar y editar materiales por lección/componente
- `/admin/settings` - Configurar modelos IA (LIA_MODEL, COMPUTER), temperatura, thinking budget
- `/admin/users` - Gestión de usuarios y roles
- `/admin/profile` - Perfil del administrador

### Builder Dashboard (`/builder`)

- `/builder/artifacts` - Artefactos del builder
- `/builder/artifacts/new` - Crear nuevo artefacto
- `/builder/artifacts/[id]` - Detalle de artefacto

### Architect Dashboard (`/architect`)

- `/architect/artifacts` - Artefactos del architect
- `/architect/artifacts/[id]` - Detalle de artefacto

---

## Base de Datos (Tablas Principales)

| Tabla                  | Contenido                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| `profiles`             | Auth Bridge: datos de usuario (sustituye referencias directas a auth.users) |
| `artifacts`            | Curso base: idea_central, objetivos[], nombres[], state, organization_id    |
| `syllabus`             | Estructura: modules (JSONB), route, validation                              |
| `instructional_plans`  | Planes: lesson_plans[], blockers, dod, validation                           |
| `curation`             | Estado de curación, qa_decision                                             |
| `curation_rows`        | Fuentes: URL, validación, aptness                                           |
| `materials`            | Estado global de materiales                                                 |
| `material_lessons`     | Componentes por lección                                                     |
| `material_components`  | Contenido + assets (slides, b_roll, production_status)                      |
| `publication_requests` | Publicación a Soflia: datos, video mapping, estado                          |
| `scorm_imports`        | Paquetes SCORM: manifiesto, análisis, estado de procesamiento               |
| `scorm_resources`      | Recursos SCORM: HTML, quizzes, mapeo a lecciones                            |
| `model_settings`       | Configuración de modelos IA por organización                                |
| `pipeline_events`      | Log de eventos del pipeline                                                 |

**Storage Buckets**: `scorm-packages`, `thumbnails`, `production-videos`

---

## Estructura del Proyecto

```
apps/
├── web/src/
│   ├── app/
│   │   ├── admin/          # Dashboard admin (artifacts, library, settings, users, profile)
│   │   ├── builder/        # Dashboard builder (artifacts)
│   │   ├── architect/      # Dashboard architect (artifacts)
│   │   ├── dashboard/      # Dashboard usuario
│   │   └── api/            # API routes (lia, auth, syllabus, publish, admin/*)
│   ├── components/
│   │   ├── lia/            # LiaChat, ChatWindow, ChatMessage
│   │   └── layout/         # SharedSidebarLayout, UserMenu
│   ├── lib/                # Servicios Lia (service, app-context, db-context, dom-mapper)
│   ├── domains/            # Lógica de negocio
│   │   ├── syllabus/       # service, types, validators, config
│   │   ├── instructionalPlan/
│   │   ├── materials/      # service, types, validators, hooks
│   │   ├── curation/       # service, types, hooks
│   │   ├── scorm/          # parser, transformation, enrichment services
│   │   └── prompts/        # tipos de prompts IA
│   └── utils/supabase/     # Clientes Supabase (client, server)
├── api/src/                # Backend Express
│   ├── features/auth/      # Módulo auth
│   └── core/middleware/    # Error handler
packages/
├── shared/                 # Tipos compartidos (Zod schemas)
└── ui/                     # Componentes UI
supabase/
└── migrations/             # Migraciones DB
netlify/functions/          # Background jobs
```

---

## Variables de Entorno

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Gemini
GOOGLE_GENERATIVE_AI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
GEMINI_SEARCH_MODEL=gemini-2.0-flash

# OpenAI (fallback)
OPENAI_API_KEY=

# Gamma
GAMMA_API_KEY=
```

---

## Patrones Importantes

- **Path aliases**: `@/*`, `@/features/*`, `@/shared/*`, `@/core/*`, `@/domains/*`
- **Estado**: Zustand para global, Supabase para persistente
- **Estilos**: TailwindCSS 4 + `cn()` para clases condicionales
- **Dark mode**: `darkMode: "class"` en Tailwind
- **Validación**: Zod para schemas
- **Componentes cliente**: `"use client"` al inicio
- **Server Actions**: Next.js server actions para mutaciones (archivos `actions.ts`)
- **Auth Bridge**: Usar tabla `profiles` en lugar de `auth.users` directamente para FK constraints
- **Multi-tenancy**: `organization_id` en artefactos, `model_settings` y `system_prompts` por organización
