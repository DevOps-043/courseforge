## **Módulo de Producción Visual y Video IA para CourseEngine / Courseforge**

**Audiencia:** equipo de desarrollo  
**Punto de partida:** CourseEngine / Courseforge en su estado actual  
**Objetivo:** extender el pipeline actual para producir artefactos visuales y videos finales usando una arquitectura inspirada en Open Design y una integración programática con HeyGen.

---

## **1\. Resumen ejecutivo**

CourseEngine ya cuenta con un pipeline sólido de ingeniería instruccional: genera concepto, syllabus, plan instruccional, fuentes curadas, materiales educativos y una fase de producción visual con Gamma y prompts de B-roll. El README actual describe una plataforma basada en Next.js, Supabase, Netlify Functions, Gemini, curaduría de fuentes, generación de materiales y HITL entre fases críticas.

La propuesta es implementar desde cero una nueva capa dentro de CourseEngine:

```
Visual & Video Production Engine
```

Esta capa agregará tres capacidades principales:

1. **Visual Skills Engine**  
   Generación de decks HTML, e-guides, carouseles, storyboards, recursos visuales y assets de soporte usando un modelo inspirado en `SKILL.md` y `DESIGN.md` de Open Design.  
2. **Branding multi-tenant**  
   Cada organización podrá tener su propio sistema visual: colores, tipografía, voz de marca, layout, estilo de slides, reglas de diseño y anti-patterns.  
3. **HeyGen Video Production**  
   Generación de videos finales con avatar, voz, subtítulos, traducción y callbacks/webhooks, usando como entrada los scripts validados por CourseEngine.

El principio rector es:

```
CourseEngine decide qué enseñar.
Open Design-style skills deciden cómo empaquetarlo visualmente.
HeyGen renderiza la presencia audiovisual.
SofLIA publica y consume el resultado final.
```

---

## **2\. Contexto del sistema actual**

CourseEngine ya tiene un pipeline de 6 fases:

```
Fase 1: Artefacto y concepto
Fase 2: Syllabus y estructura
Fase 3: Planificación instruccional
Fase 4: Curaduría e investigación deep
Fase 5: Generación de materiales
Fase 6: Producción visual
```

La Fase 5 ya genera materiales como:

```
DIALOGUE
READING
QUIZ
DEMO_GUIDE
EXERCISE
VIDEO_THEORETICAL
VIDEO_DEMO
VIDEO_GUIDE
```

Y la Fase 6 ya contempla prompts de B-roll, integración con Gamma, decks y estados como:

```
PENDING → IN_PROGRESS → DECK_READY → EXPORTED → COMPLETED
```

La implementación propuesta no sustituye este pipeline. Lo extiende a partir de la Fase 6\.

---

## **3\. Objetivo del proyecto**

Implementar un subsistema de producción visual y audiovisual que permita convertir materiales aprobados de CourseEngine en:

```
- Decks HTML
- Decks exportables a PDF / ZIP
- E-guides
- Storyboards visuales
- Carouseles
- Intros de curso
- Videos teóricos con avatar
- Videos demo con avatar o narración
- Videos guía
- Subtítulos
- Traducciones multi-idioma
- Thumbnails
- Assets listos para publicación en SofLIA
```

El sistema debe preservar los tres principios actuales de CourseEngine:

```
1. No alucinación
2. Estructura primero, contenido después
3. Human-in-the-loop
```

---

## **4\. Alcance funcional**

### **4.1 Incluido en el MVP**

El MVP debe implementar:

```
1. Catálogo interno de visual skills
2. DESIGN.md por organización
3. Generación de deck HTML por módulo/lección
4. Generación de e-guide por módulo/lección
5. Preview sandboxed del artefacto visual
6. Export básico: HTML, PDF y ZIP
7. Configuración de HeyGen por organización
8. Sincronización manual o semiautomática de avatars y voices
9. Generación de video HeyGen desde script aprobado
10. Webhook/callback para recibir estado de render
11. QA humana antes de publicar
12. Publicación del asset visual/video a SofLIA
```

### **4.2 Fuera del MVP**

No se recomienda incluir en la primera versión:

```
- Reemplazo total de Gamma
- Editor visual tipo Figma
- Edición quirúrgica de HTML por selección visual
- Generación de video multi-escena compleja
- Streaming avatar en vivo
- Digital Twin self-service
- Traducción automática masiva de todos los cursos
- Marketplace de skills
- Uso directo del daemon local de Open Design en producción
```

---

## **5\. Referencias técnicas externas**

### **5.1 Open Design**

Open Design es un proyecto open-source, local-first y BYOK que convierte agentes de código en motores de diseño mediante skills y design systems. Su README actual describe soporte para múltiples coding-agent CLIs, skills componibles, design systems, preview sandboxed y exportación en formatos como HTML, PDF y ZIP. ([GitHub](https://github.com/nexu-io/open-design))

Para CourseEngine no se propone copiar el runtime completo de Open Design. Se propone adoptar los conceptos:

```
- SKILL.md como contrato de producción visual
- DESIGN.md como contrato de marca
- Preview sandboxed
- Export HTML/PDF/ZIP
- Checklists de calidad visual
```

Open Design también lista skills como `digital-eguide`, `html-ppt-course-module`, `social-carousel`, `video-shortform`, `docs-page`, `dashboard`, entre otras, lo cual valida que el modelo de skills puede mapearse bien a salidas educativas. ([GitHub](https://github.com/nexu-io/open-design/tree/main/skills))

### **5.2 HeyGen**

HeyGen documenta dos rutas principales para crear videos programáticamente: `POST /v3/video-agents`, orientada a prompts y velocidad, y `POST /v3/videos`, orientada a control explícito de avatar, voz y script. Para CourseEngine, la ruta principal recomendada es Direct Video porque el sistema ya genera scripts validados en Fase 5\. ([HeyGen](https://developers.heygen.com/docs/choosing-the-right-video-api))

HeyGen también soporta `callback_url` y `callback_id` para correlacionar respuestas asíncronas, y permite webhooks persistentes con verificación mediante HMAC-SHA256 usando el secret del endpoint. ([HeyGen](https://developers.heygen.com/docs/webhooks))

---

## **6\. Arquitectura objetivo**

### **6.1 Vista general**

```
┌─────────────────────────────────────────────────────────────┐
│                      CourseEngine UI                         │
│                                                             │
│  Builder / Admin / QA / Visual Production / Publish          │
└───────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                 Netlify Functions / Backend                  │
│                                                             │
│  visual-artifact-generate                                   │
│  visual-artifact-export                                     │
│  heygen-create-video                                        │
│  heygen-webhook                                             │
│  heygen-sync-catalogs                                       │
│  publish-to-soflia                                          │
└───────────────────────────────┬─────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                         Supabase                             │
│                                                             │
│  artifacts                                                   │
│  instructional_plans                                         │
│  curation_rows                                               │
│  materials                                                   │
│  material_lessons                                            │
│  visual_artifacts                                            │
│  visual_skills                                               │
│  organization_design_systems                                 │
│  heygen_video_jobs                                           │
│  organization_video_settings                                 │
└───────────────────────────────┬─────────────────────────────┘
                                │
                ┌───────────────┴────────────────┐
                ▼                                ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ Open Design-style Renderer   │   │ HeyGen API                │
│                              │   │                          │
│ SKILL.md + DESIGN.md + JSON  │   │ Avatar / Voice / Video    │
│ HTML / PDF / ZIP             │   │ MP4 / SRT / Thumbnail     │
└──────────────────────────────┘   └──────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                         SofLIA                               │
│                                                             │
│  Curso publicado con materiales, visuales y videos           │
└─────────────────────────────────────────────────────────────┘
```

---

## **7\. Principios de diseño técnico**

### **7.1 CourseEngine sigue siendo la fuente de verdad**

Los modelos externos no deben decidir contenido pedagógico final.

```
CourseEngine:
- Objetivos
- Syllabus
- Plan instruccional
- Fuentes aprobadas
- Materiales aprobados
- Scripts aprobados

Open Design-style Renderer:
- Layout
- Sistema visual
- Packaging
- Export

HeyGen:
- Avatar
- Voz
- Render de video
- Subtítulos
- Traducción
```

### **7.2 No enviar contexto innecesario a proveedores externos**

A HeyGen se le debe enviar:

```
- Script aprobado
- Avatar ID
- Voice ID
- Configuración de video
- Callback URL
- Callback ID
```

No se debe enviar:

```
- Dumps completos de Supabase
- Fuentes completas si no son necesarias
- Datos sensibles de usuarios
- Tokens internos
- Información multi-tenant de otras organizaciones
```

### **7.3 Todo artefacto debe pasar por QA humana**

Nuevos estados requeridos:

```
VISUAL_READY_FOR_QA
VIDEO_READY_FOR_QA
APPROVED_FOR_EXPORT
APPROVED_FOR_PUBLICATION
```

---

## **8\. Nuevo flujo propuesto**

### **8.1 Flujo completo**

```
1. Admin crea curso
2. CourseEngine genera concepto
3. Admin aprueba concepto
4. CourseEngine genera syllabus
5. Admin aprueba syllabus
6. CourseEngine genera plan instruccional
7. CourseEngine cura fuentes
8. Admin aprueba fuentes
9. CourseEngine genera materiales
10. Admin aprueba materiales
11. Visual Engine genera decks/e-guides/storyboards
12. Admin aprueba visuales
13. HeyGen genera videos desde scripts aprobados
14. Admin aprueba videos
15. CourseEngine publica paquete final a SofLIA
```

### **8.2 Flujo de producción visual**

```
Input:
- artifact_id
- lesson_id o module_id
- material_lesson_id
- visual_skill_id
- organization_id
- design_system_id

Proceso:
1. Leer lesson_plan
2. Leer material aprobado
3. Leer fuentes aprobadas
4. Leer DESIGN.md de la organización
5. Leer SKILL.md de la visual skill
6. Construir prompt de generación visual
7. Generar HTML autocontenido
8. Validar HTML
9. Renderizar preview en iframe sandboxed
10. Guardar artefacto
11. Esperar QA
12. Exportar
```

### **8.3 Flujo de producción HeyGen**

```
Input:
- artifact_id
- lesson_id
- material_lesson_id
- video_component_type
- approved_script
- avatar_id
- voice_id
- organization_id

Proceso:
1. Validar que el script esté aprobado
2. Validar presupuesto y límites de duración
3. Crear heygen_video_job
4. Enviar request a HeyGen
5. Guardar heygen_video_id / callback_id
6. Recibir callback o webhook
7. Actualizar status
8. Guardar video_url / subtitle_url / thumbnail_url
9. Mostrar video en QA
10. Aprobar
11. Publicar a SofLIA
```

---

## **9\. Modelo de dominio**

### **9.1 Nuevas entidades**

```
VisualSkill
OrganizationDesignSystem
VisualArtifact
VisualArtifactExport
OrganizationVideoSettings
HeyGenCatalogAvatar
HeyGenCatalogVoice
HeyGenVideoJob
VideoAsset
PublicationAsset
```

---

## **10\. Modelo de datos propuesto**

### **10.1 `visual_skills`**

```sql
create table visual_skills (
  id uuid primary key default gen_random_uuid(),

  code text not null unique,
  name text not null,
  description text,

  category text not null,
  output_type text not null,
  skill_md text not null,

  compatible_component_types text[] default '{}',
  compatible_scopes text[] default '{lesson,module,course}',

  requires_design_system boolean default true,
  is_active boolean default true,
  is_system boolean default true,

  version integer default 1,
  metadata jsonb default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Ejemplos de `code`:

```
course_module_deck
lesson_eguide
quiz_review_deck
demo_guide_page
video_storyboard
social_carousel
course_intro_deck
```

---

### **10.2 `organization_design_systems`**

```sql
create table organization_design_systems (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  name text not null,

  design_md text not null,

  logo_url text,
  primary_color text,
  secondary_color text,
  font_heading text,
  font_body text,

  tone text,
  source text default 'manual',

  is_default boolean default false,
  is_active boolean default true,

  metadata jsonb default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Ejemplo conceptual de `DESIGN.md`:

```
# SofLIA Corporate Learning Design System

## Brand personality
Clara, confiable, moderna, educativa.

## Colors
Primary: #2563EB
Secondary: #14B8A6
Background: #F8FAFC
Text: #0F172A

## Typography
Headings: Inter
Body: Inter

## Layout
Slides deben usar mucho espacio en blanco.
Máximo 1 idea principal por slide.
Usar bloques laterales para objetivos de aprendizaje.

## Components
- Learning objective card
- Quiz card
- Key concept panel
- Source citation footer
- Reflection prompt

## Anti-patterns
- No usar paredes de texto
- No inventar datos
- No mezclar más de 2 estilos visuales
- No usar imágenes decorativas sin función didáctica
```

---

### **10.3 `visual_artifacts`**

```sql
create table visual_artifacts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  artifact_id uuid not null,

  module_id text,
  lesson_id text,
  material_lesson_id uuid,

  visual_skill_id uuid references visual_skills(id),
  design_system_id uuid references organization_design_systems(id),

  type text not null,
  scope text not null,

  status text not null default 'PENDING',

  title text,
  prompt_snapshot text,
  skill_snapshot text,
  design_snapshot text,

  html text,
  preview_url text,

  validation_status text default 'PENDING',
  validation_errors jsonb default '[]',

  qa_status text default 'PENDING',
  qa_notes text,

  metadata jsonb default '{}',

  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Estados sugeridos:

```
PENDING
GENERATING
GENERATED
VALIDATION_FAILED
READY_FOR_QA
NEEDS_REVISION
APPROVED
EXPORTING
EXPORTED
FAILED
```

---

### **10.4 `visual_artifact_exports`**

```sql
create table visual_artifact_exports (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  visual_artifact_id uuid references visual_artifacts(id),

  format text not null,
  status text not null default 'PENDING',

  storage_path text,
  public_url text,

  file_size_bytes bigint,
  metadata jsonb default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Formatos:

```
html
pdf
zip
png
pptx_future
```

---

### **10.5 `organization_video_settings`**

```sql
create table organization_video_settings (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null unique,

  provider text not null default 'heygen',

  api_key_secret_name text default 'HEYGEN_API_KEY',

  default_avatar_id text,
  default_voice_id text,

  default_resolution text default '1080p',
  default_aspect_ratio text default '16:9',
  default_output_format text default 'mp4',

  captions_enabled boolean default true,
  translation_enabled boolean default false,

  max_video_duration_seconds integer default 600,
  monthly_budget_usd numeric,
  require_approval_over_usd numeric default 0,

  is_active boolean default true,

  metadata jsonb default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

---

### **10.6 `heygen_catalog_avatars`**

```sql
create table heygen_catalog_avatars (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,

  heygen_avatar_id text not null,
  name text,
  preview_url text,

  gender text,
  language text,
  is_default boolean default false,
  is_active boolean default true,

  metadata jsonb default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (organization_id, heygen_avatar_id)
);
```

---

### **10.7 `heygen_catalog_voices`**

```sql
create table heygen_catalog_voices (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,

  heygen_voice_id text not null,
  name text,
  language text,
  gender text,
  provider_metadata jsonb default '{}',

  is_default boolean default false,
  is_active boolean default true,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (organization_id, heygen_voice_id)
);
```

---

### **10.8 `heygen_video_jobs`**

```sql
create table heygen_video_jobs (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  artifact_id uuid not null,

  module_id text,
  lesson_id text,
  material_lesson_id uuid,

  component_type text not null,

  provider text not null default 'heygen',
  mode text not null default 'direct_video',

  status text not null default 'PENDING',

  heygen_video_id text,
  callback_id text unique,

  avatar_id text,
  voice_id text,

  title text,
  script text not null,

  aspect_ratio text default '16:9',
  resolution text default '1080p',
  output_format text default 'mp4',

  captions_enabled boolean default true,

  video_url text,
  captioned_video_url text,
  subtitle_url text,
  thumbnail_url text,

  duration_seconds numeric,
  estimated_cost_usd numeric,
  actual_cost_usd numeric,

  qa_status text default 'PENDING',
  qa_notes text,

  failure_code text,
  failure_message text,

  request_payload jsonb,
  response_payload jsonb,
  webhook_payload jsonb,

  metadata jsonb default '{}',

  submitted_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Estados sugeridos:

```
PENDING
SCRIPT_READY
READY_FOR_SUBMISSION
SUBMITTED_TO_HEYGEN
RENDERING
VIDEO_READY
READY_FOR_QA
NEEDS_REVISION
APPROVED
PUBLISHED
FAILED
```

---

## **11\. Backend propuesto**

### **11.1 Nuevas Netlify Functions**

```
apps/web/netlify/functions/
├── visual-skills-list.ts
├── visual-artifact-generate.ts
├── visual-artifact-regenerate.ts
├── visual-artifact-validate.ts
├── visual-artifact-export.ts
├── visual-artifact-approve.ts
├── heygen-sync-avatars.ts
├── heygen-sync-voices.ts
├── heygen-create-video.ts
├── heygen-video-status.ts
├── heygen-webhook.ts
├── heygen-approve-video.ts
└── publish-production-assets.ts
```

---

### **11.2 `visual-artifact-generate.ts`**

Responsabilidad:

```
Generar un artefacto visual desde material aprobado.
```

Input:

```ts
type GenerateVisualArtifactInput = {
  artifactId: string;
  organizationId: string;
  scope: 'lesson' | 'module' | 'course';
  moduleId?: string;
  lessonId?: string;
  materialLessonId?: string;
  visualSkillCode: string;
  designSystemId?: string;
};
```

Proceso:

```
1. Validar auth y organization_id
2. Leer artifact
3. Leer instructional_plan
4. Leer material_lesson aprobado
5. Leer curation_rows aprobadas
6. Leer visual_skill
7. Leer organization_design_system
8. Construir prompt
9. Llamar modelo generativo configurado para VISUAL_PRODUCTION
10. Extraer HTML
11. Validar HTML
12. Guardar visual_artifact
13. Marcar READY_FOR_QA
```

---

### **11.3 Prompt base para artefactos visuales**

```
Eres el motor de producción visual de CourseEngine.

Tu tarea es generar un artefacto visual educativo usando únicamente
información validada por CourseEngine.

Reglas no negociables:
- No inventes hechos, cifras, fuentes ni claims.
- No agregues referencias que no estén en approved_sources.
- Respeta el objetivo de aprendizaje.
- Respeta el tipo de componente instruccional.
- Respeta el DESIGN.md de la organización.
- Respeta el SKILL.md de la salida visual.
- Devuelve únicamente un HTML autocontenido.
- No uses scripts externos.
- No cargues recursos remotos no autorizados.
- Incluye notas o captions solo si están en el material base.
```

Prompt compuesto:

```
{{BASE_VISUAL_PROMPT}}

# DESIGN.md
{{organization_design_system.design_md}}

# SKILL.md
{{visual_skill.skill_md}}

# Course context
{{artifact_summary}}

# Lesson plan
{{lesson_plan_json}}

# Approved material
{{material_lesson_json}}

# Approved sources
{{approved_sources_json}}

# Output requirements
Return a single self-contained HTML document.
```

---

### **11.4 `visual-artifact-validate.ts`**

Validaciones mínimas:

```
1. HTML parseable
2. No `<script>` salvo allowlist explícita
3. No URLs externas no autorizadas
4. No texto “lorem ipsum”
5. No placeholders visibles
6. Incluye título
7. Incluye objetivo de aprendizaje
8. Incluye referencia a fuentes aprobadas cuando aplique
9. Tamaño máximo razonable
10. Contraste mínimo si se puede automatizar
```

Posibles librerías:

```
- zod
- htmlparser2
- sanitize-html
- playwright para screenshot/export
```

---

### **11.5 `visual-artifact-export.ts`**

Responsabilidad:

```
Exportar visual_artifact aprobado.
```

Formatos MVP:

```
- HTML
- PDF
- ZIP
```

Proceso:

```
1. Validar que visual_artifact esté APPROVED
2. Crear archivo temporal
3. Renderizar con Playwright/Puppeteer
4. Guardar en Supabase Storage
5. Crear registro visual_artifact_exports
6. Devolver URL
```

---

## **12\. Integración HeyGen**

### **12.1 Decisión de API**

Para videos finales de lecciones se usará:

```
POST /v3/videos
```

Motivo:

```
- CourseEngine ya genera el script
- El script ya pasa por QA
- Se requiere control sobre avatar y voz
- Se requiere output predecible y repetible
```

Para piezas promocionales o exploratorias se podrá usar más adelante:

```
POST /v3/video-agents
```

HeyGen documenta Direct Video como la opción recomendada cuando se necesita control explícito sobre avatar, voz y script, mientras que Video Agent es más adecuado cuando se busca rapidez y composición a partir de prompt. ([HeyGen](https://developers.heygen.com/docs/choosing-the-right-video-api))

---

### **12.2 `heygen-create-video.ts`**

Input:

```ts
type CreateHeyGenVideoInput = {
  artifactId: string;
  organizationId: string;
  lessonId: string;
  materialLessonId: string;
  componentType: 'VIDEO_THEORETICAL' | 'VIDEO_DEMO' | 'VIDEO_GUIDE';
  avatarId?: string;
  voiceId?: string;
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  captionsEnabled?: boolean;
};
```

Proceso:

```
1. Validar auth y tenant
2. Leer material_lesson
3. Validar que component_type sea VIDEO_*
4. Extraer script aprobado
5. Leer organization_video_settings
6. Resolver avatar_id y voice_id
7. Estimar duración y costo
8. Verificar límites de presupuesto
9. Crear heygen_video_job
10. Enviar request a HeyGen
11. Guardar response
12. Actualizar status a SUBMITTED_TO_HEYGEN
```

Request conceptual:

```ts
const response = await fetch('https://api.heygen.com/v3/videos', {
  method: 'POST',
  headers: {
    'X-Api-Key': process.env.HEYGEN_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'avatar',
    avatar_id: avatarId,
    voice_id: voiceId,
    script: approvedScript,
    callback_url: `${process.env.APP_URL}/.netlify/functions/heygen-webhook`,
    callback_id: callbackId,
  }),
});
```

---

### **12.3 `heygen-webhook.ts`**

Responsabilidad:

```
Recibir eventos asíncronos de HeyGen y actualizar el job interno.
```

HeyGen permite registrar endpoints persistentes o usar `callback_url` directamente por video; el `callback_id` se devuelve en el payload para correlacionar la notificación con la solicitud original. ([HeyGen](https://developers.heygen.com/docs/webhooks))

Proceso:

```
1. Recibir POST
2. Leer raw body
3. Verificar HMAC si aplica
4. Responder 200 rápido
5. Procesar evento
6. Buscar heygen_video_jobs.callback_id
7. Actualizar status
8. Guardar video_url, subtitle_url, thumbnail_url
9. Mover a READY_FOR_QA
10. Registrar errores si falla
```

Validación de firma:

```
- Guardar secret del webhook en vault/env
- Calcular HMAC-SHA256 sobre raw body
- Comparar contra header recibido
- Rechazar si no coincide
```

---

## **13\. Frontend propuesto**

### **13.1 Nuevas rutas**

```
apps/web/src/app/admin/
├── visual-skills/
│   └── page.tsx
├── design-systems/
│   └── page.tsx
├── video-settings/
│   └── page.tsx
└── artifacts/[id]/
    ├── visual-production/
    │   └── page.tsx
    ├── video-production/
    │   └── page.tsx
    └── production-review/
        └── page.tsx
```

---

### **13.2 Pantalla: Visual Production**

Debe mostrar:

```
- Módulos y lecciones
- Materiales disponibles
- Tipo de visual recomendado
- Skill seleccionada
- Design system seleccionado
- Botón generar
- Preview HTML sandboxed
- Estado de validación
- QA notes
- Aprobar / regenerar / exportar
```

Layout sugerido:

```
┌─────────────────────┬──────────────────────────────────────┐
│ Lessons / Materials │ Preview                              │
│                     │                                      │
│ Module 1            │ [iframe sandbox]                     │
│  - Lesson 1         │                                      │
│  - Lesson 2         │                                      │
│                     │                                      │
├─────────────────────┼──────────────────────────────────────┤
│ Skill settings      │ QA panel                             │
│ Design system       │ Approve / Needs revision / Export    │
└─────────────────────┴──────────────────────────────────────┘
```

---

### **13.3 Pantalla: Video Production**

Debe mostrar:

```
- Lista de componentes VIDEO_* por lección
- Script aprobado
- Avatar seleccionado
- Voice seleccionada
- Duración estimada
- Costo estimado
- Estado del render
- Preview del video
- Subtítulos
- QA notes
- Aprobar / regenerar / publicar
```

Layout sugerido:

```
┌─────────────────────┬──────────────────────────────────────┐
│ Video components    │ Script / Preview                     │
│                     │                                      │
│ VIDEO_THEORETICAL   │ [script approved]                    │
│ VIDEO_DEMO          │ [video player when ready]            │
│ VIDEO_GUIDE         │                                      │
├─────────────────────┼──────────────────────────────────────┤
│ Avatar / Voice      │ QA + Publish                         │
└─────────────────────┴──────────────────────────────────────┘
```

---

## **14\. Extensión de `model_settings`**

Agregar nuevo setting type:

```
VISUAL_PRODUCTION
```

Opcionalmente:

```
VISUAL_QA
VIDEO_SCRIPT_REWRITE
VIDEO_STORYBOARD
```

Ejemplo:

```sql
insert into model_settings (
  organization_id,
  setting_type,
  provider,
  model,
  temperature,
  fallback_provider,
  fallback_model
) values (
  :organization_id,
  'VISUAL_PRODUCTION',
  'google',
  'gemini-2.0-flash',
  0.4,
  'openai',
  'gpt-4.1-mini'
);
```

---

## **15\. Extensión de `system_prompts`**

Agregar prompts versionados:

```
VISUAL_ARTIFACT_GENERATION
VISUAL_ARTIFACT_VALIDATION
VIDEO_PRODUCTION_PREP
HEYGEN_SCRIPT_NORMALIZATION
```

Ejemplo:

```
VISUAL_ARTIFACT_GENERATION:
Usado para convertir materiales aprobados en HTML visual.

HEYGEN_SCRIPT_NORMALIZATION:
Usado para limpiar scripts antes de enviarlos a HeyGen.
No cambia contenido factual.
Solo mejora oralidad, pausas y pronunciación.
```

---

## **16\. Contratos de salida**

### **16.1 Contrato de artefacto visual**

```ts
type VisualArtifactContract = {
  id: string;
  artifactId: string;
  organizationId: string;
  scope: 'lesson' | 'module' | 'course';
  type:
    | 'course_module_deck'
    | 'lesson_eguide'
    | 'quiz_review_deck'
    | 'demo_guide_page'
    | 'video_storyboard'
    | 'social_carousel';

  status:
    | 'PENDING'
    | 'GENERATING'
    | 'GENERATED'
    | 'READY_FOR_QA'
    | 'APPROVED'
    | 'EXPORTED'
    | 'FAILED';

  html?: string;
  previewUrl?: string;
  exports?: {
    format: 'html' | 'pdf' | 'zip';
    url: string;
  }[];

  metadata: Record<string, unknown>;
};
```

---

### **16.2 Contrato de video**

```ts
type HeyGenVideoJobContract = {
  id: string;
  artifactId: string;
  organizationId: string;
  lessonId: string;
  componentType: 'VIDEO_THEORETICAL' | 'VIDEO_DEMO' | 'VIDEO_GUIDE';

  status:
    | 'PENDING'
    | 'SUBMITTED_TO_HEYGEN'
    | 'RENDERING'
    | 'VIDEO_READY'
    | 'READY_FOR_QA'
    | 'APPROVED'
    | 'PUBLISHED'
    | 'FAILED';

  avatarId: string;
  voiceId: string;
  script: string;

  videoUrl?: string;
  subtitleUrl?: string;
  thumbnailUrl?: string;

  estimatedCostUsd?: number;
  actualCostUsd?: number;

  callbackId: string;
  metadata: Record<string, unknown>;
};
```

---

## **17\. Publicación a SofLIA**

La publicación debe empaquetar:

```
- Materiales educativos aprobados
- Decks o e-guides aprobados
- Videos aprobados
- Subtítulos
- Thumbnails
- Metadata de lección
- Fuente de cada asset
```

Contrato sugerido:

```ts
type SofliaPublicationAsset = {
  artifactId: string;
  organizationId: string;
  lessonId?: string;
  moduleId?: string;

  assetType:
    | 'reading'
    | 'quiz'
    | 'dialogue'
    | 'exercise'
    | 'demo_guide'
    | 'visual_deck'
    | 'eguide'
    | 'video'
    | 'subtitle'
    | 'thumbnail';

  title: string;
  url?: string;
  html?: string;
  metadata: Record<string, unknown>;
};
```

---

## **18\. Seguridad y multi-tenancy**

### **18.1 Reglas obligatorias**

```
1. Todas las queries deben filtrar por organization_id.
2. Ningún callback externo debe actualizar registros sin callback_id válido.
3. API keys de HeyGen nunca deben llegar al cliente.
4. HTML generado debe sanearse antes de preview/export.
5. Preview debe usar iframe sandboxed.
6. Exports deben guardarse en rutas por organización.
7. Webhook debe responder rápido y procesar async.
8. Logs no deben imprimir scripts sensibles completos.
```

---

### **18.2 Storage paths sugeridos**

```
organizations/{organization_id}/artifacts/{artifact_id}/visuals/{visual_artifact_id}/index.html

organizations/{organization_id}/artifacts/{artifact_id}/visuals/{visual_artifact_id}/export.pdf

organizations/{organization_id}/artifacts/{artifact_id}/videos/{heygen_video_job_id}/video.mp4

organizations/{organization_id}/artifacts/{artifact_id}/videos/{heygen_video_job_id}/subtitles.srt

organizations/{organization_id}/artifacts/{artifact_id}/videos/{heygen_video_job_id}/thumbnail.png
```

---

## **19\. Observabilidad**

### **19.1 Logs requeridos**

Prefijos sugeridos:

```
[VisualArtifact]
[VisualValidation]
[VisualExport]
[HeyGenCreate]
[HeyGenWebhook]
[HeyGenCatalog]
[ProductionPublish]
```

### **19.2 Métricas mínimas**

```
- visual_artifact_generation_duration_ms
- visual_artifact_validation_failures
- visual_artifact_exports_count
- heygen_jobs_created
- heygen_jobs_failed
- heygen_render_duration_seconds
- estimated_video_cost_usd
- actual_video_cost_usd
- qa_rejection_rate
```

---

## **20\. Estrategia de QA**

### **20.1 QA automática visual**

Validar:

```
- HTML parseable
- No scripts inseguros
- No assets externos no permitidos
- No placeholders
- No contenido vacío
- Incluye objetivos
- Incluye fuentes si aplica
- No inventa bibliografía
```

### **20.2 QA humana visual**

Checklist:

```
- ¿El artefacto explica correctamente la lección?
- ¿Respeta el objetivo de aprendizaje?
- ¿La jerarquía visual ayuda a aprender?
- ¿El diseño respeta la marca?
- ¿Hay demasiado texto?
- ¿Hay claims no sustentados?
- ¿Está listo para exportar/publicar?
```

### **20.3 QA humana de video**

Checklist:

```
- ¿El avatar y la voz son apropiados?
- ¿La pronunciación es correcta?
- ¿El ritmo es adecuado?
- ¿El video respeta el script?
- ¿No agrega información nueva?
- ¿Los subtítulos coinciden?
- ¿El thumbnail es usable?
- ¿Está listo para SofLIA?
```

---

## **21\. Plan de implementación por fases**

### **Fase A — Foundation**

Objetivo:

```
Crear la base de datos, tipos compartidos y settings.
```

Entregables:

```
- Migraciones SQL
- Tipos TypeScript
- visual_skills seed
- organization_design_systems CRUD básico
- organization_video_settings CRUD básico
- Feature flags
```

Definition of Done:

```
- Migraciones corren en local y staging
- Tipos compartidos disponibles en packages/shared
- Admin puede ver/configurar design system
- Admin puede ver/configurar video settings
```

---

### **Fase B — Visual Skills MVP**

Objetivo:

```
Generar el primer deck HTML desde una lección aprobada.
```

Entregables:

```
- visual-artifact-generate.ts
- visual-artifact-validate.ts
- visual_artifacts table integrada
- Preview sandboxed
- Skill course_module_deck
- Skill lesson_eguide
```

Definition of Done:

```
- Una lección aprobada produce un deck HTML
- El deck se guarda en Supabase
- El preview carga en iframe sandboxed
- El admin puede aprobar o pedir revisión
```

---

### **Fase C — Export**

Objetivo:

```
Exportar visuales aprobados.
```

Entregables:

```
- visual-artifact-export.ts
- Export HTML
- Export PDF
- Export ZIP
- Registro en visual_artifact_exports
```

Definition of Done:

```
- Solo artefactos aprobados pueden exportarse
- Export se guarda en Supabase Storage
- URL queda asociada al visual_artifact
```

---

### **Fase D — HeyGen MVP**

Objetivo:

```
Generar un video desde un VIDEO_THEORETICAL aprobado.
```

Entregables:

```
- heygen-create-video.ts
- heygen-webhook.ts
- heygen_video_jobs table
- UI de video production
- Selector avatar/voice básico
```

Definition of Done:

```
- Admin puede enviar un script aprobado a HeyGen
- El job cambia a SUBMITTED_TO_HEYGEN
- Callback/webhook actualiza a VIDEO_READY
- UI muestra video listo para QA
- Admin puede aprobar video
```

---

### **Fase E — Publicación integrada**

Objetivo:

```
Publicar materiales + visuales + videos a SofLIA.
```

Entregables:

```
- publish-production-assets.ts
- Mapeo de assets por lección
- Estados de publicación
- Validación de que no se publiquen assets sin aprobar
```

Definition of Done:

```
- Curso publicado incluye materiales existentes
- Incluye visuales aprobados
- Incluye videos aprobados
- Publicación respeta organization_id
```

---

### **Fase F — Hardening**

Objetivo:

```
Estabilizar seguridad, costos, errores y observabilidad.
```

Entregables:

```
- Rate limits
- Presupuesto mensual por organización
- Logs estructurados
- Retry controlado
- Alertas de fallos
- Validación HMAC
- Tests e2e mínimos
```

Definition of Done:

```
- Errores externos no dejan spinners infinitos
- Jobs fallidos quedan diagnosticables
- Se bloquea generación por presupuesto
- Webhook inválido no actualiza jobs
```

---

## **22\. Backlog técnico inicial**

### **Backend**

```
[BE-001] Crear migraciones visual_skills
[BE-002] Crear migraciones organization_design_systems
[BE-003] Crear migraciones visual_artifacts
[BE-004] Crear migraciones visual_artifact_exports
[BE-005] Crear migraciones organization_video_settings
[BE-006] Crear migraciones heygen_video_jobs
[BE-007] Implementar visual-artifact-generate
[BE-008] Implementar visual-artifact-validate
[BE-009] Implementar visual-artifact-export
[BE-010] Implementar heygen-create-video
[BE-011] Implementar heygen-webhook
[BE-012] Implementar publish-production-assets
```

### **Frontend**

```
[FE-001] Crear pantalla admin/design-systems
[FE-002] Crear pantalla admin/visual-skills
[FE-003] Crear pantalla artifact visual-production
[FE-004] Crear preview sandboxed
[FE-005] Crear QA panel visual
[FE-006] Crear pantalla video-production
[FE-007] Crear selector avatar/voice
[FE-008] Crear video player QA
[FE-009] Crear publish checklist
```

### **AI / Prompting**

```
[AI-001] Crear prompt VISUAL_ARTIFACT_GENERATION
[AI-002] Crear prompt VISUAL_ARTIFACT_VALIDATION
[AI-003] Crear skill course_module_deck
[AI-004] Crear skill lesson_eguide
[AI-005] Crear skill video_storyboard
[AI-006] Crear normalizador de script para HeyGen
```

### **DevOps / Seguridad**

```
[SEC-001] Agregar env HEYGEN_API_KEY
[SEC-002] Agregar env HEYGEN_WEBHOOK_SECRET
[SEC-003] Implementar HMAC verification
[SEC-004] Configurar storage paths por tenant
[SEC-005] Agregar feature flags
[SEC-006] Agregar logging estructurado
```

---

## **23\. Variables de entorno**

```
# HeyGen
HEYGEN_API_KEY=
HEYGEN_WEBHOOK_SECRET=

# App
APP_URL=

# Visual Export
VISUAL_EXPORT_STORAGE_BUCKET=production-assets

# Feature flags
ENABLE_VISUAL_PRODUCTION=true
ENABLE_HEYGEN_VIDEO=true
ENABLE_VISUAL_EXPORT=true
```

---

## **24\. Riesgos y mitigaciones**

| Riesgo | Impacto | Mitigación |
| ----- | ----- | ----- |
| HTML generado inseguro | Alto | Sanitización, iframe sandboxed, bloqueo de scripts |
| HeyGen falla o tarda | Medio | Estados claros, retry manual, fallback a script descargable |
| Costos de video se disparan | Alto | Presupuesto por organización y aprobación previa |
| Se publica contenido sin QA | Alto | Bloquear export/publicación si no está APPROVED |
| Alucinación en visuales | Alto | Usar solo materiales/fuentes aprobadas y validación |
| Webhook falso | Alto | HMAC \+ callback\_id único |
| Dependencia de proveedor | Medio | Abstraer `video_provider` y mantener assets externos desacoplados |
| Gamma y visual engine se traslapan | Medio | Mantener ambos como providers separados |

---

## **25\. Decisiones técnicas recomendadas**

### **25.1 No usar el daemon de Open Design en producción**

Open Design está diseñado como local-first y usa agentes CLI detectados en `PATH`, daemon local y workspace de archivos. Eso es útil como referencia, pero no encaja directamente con un SaaS multi-tenant serverless. ([GitHub](https://github.com/nexu-io/open-design))

Recomendación:

```
Adoptar conceptos, no runtime.
```

Implementar internamente:

```
- visual_skills
- design_systems
- prompt composer
- preview sandboxed
- export pipeline
```

---

### **25.2 Usar HeyGen Direct Video para lecciones**

Recomendación:

```
Usar POST /v3/videos para VIDEO_THEORETICAL, VIDEO_DEMO y VIDEO_GUIDE.
```

Usar Video Agent solo para:

```
- Trailers
- Videos promocionales
- Intros exploratorias
- Prototipos rápidos
```

---

### **25.3 Mantener Gamma como provider paralelo**

No reemplazar Gamma en MVP.

```
Gamma Provider:
- Decks rápidos externos

Visual Engine Provider:
- Decks HTML propios
- E-guides
- Storyboards
- Export controlado

HeyGen Provider:
- Videos finales
```

---

## **26\. Resultado esperado**

Al terminar la implementación, CourseEngine podrá producir un curso completo con:

```
1. Syllabus aprobado
2. Plan instruccional aprobado
3. Fuentes curadas aprobadas
4. Materiales educativos aprobados
5. Decks/e-guides visuales aprobados
6. Videos con avatar aprobados
7. Assets exportados
8. Publicación completa a SofLIA
```

El sistema pasará de ser:

```
Course generation engine
```

a ser:

```
AI Instructional Production Studio
```

con un pipeline más completo:

```
Investigación → Diseño instruccional → Curaduría → Materiales → Visuales → Video → Publicación
```

---

## **27\. Primer corte recomendado para desarrollo**

Para iniciar sin sobrecargar al equipo, construiría únicamente este flujo:

```
MVP 1:
1. organization_design_systems
2. visual_skills con course_module_deck
3. visual_artifact_generate desde una lección aprobada
4. preview sandboxed
5. aprobación visual

MVP 2:
6. export PDF/ZIP
7. heygen_video_jobs
8. heygen-create-video desde VIDEO_THEORETICAL
9. heygen-webhook
10. aprobación de video

MVP 3:
11. publicación a SofLIA con assets visuales y video
```

Con eso el equipo puede entregar valor visible rápido sin tocar el corazón pedagógico del CourseEngine.

