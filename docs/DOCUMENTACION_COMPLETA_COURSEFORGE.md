# 📚 Documentación Completa - CourseForge

> **Plataforma de Creación de Cursos con IA**
> 
> Versión: 1.0.0  
> Última actualización: Enero 2026  
> Generado automáticamente para análisis con herramientas externas

---

## 📑 Tabla de Contenidos

1. [Visión General del Proyecto](#1-visión-general-del-proyecto)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Modelo de Datos (Base de Datos)](#4-modelo-de-datos-base-de-datos)
5. [Pipeline de Generación de Cursos](#5-pipeline-de-generación-de-cursos)
6. [Frontend - Aplicación Web](#6-frontend---aplicación-web)
7. [Backend - API y Funciones](#7-backend---api-y-funciones)
8. [Sistema de Diseño](#8-sistema-de-diseño)
9. [Integraciones de IA](#9-integraciones-de-ia)
10. [Estructura de Archivos](#10-estructura-de-archivos)
11. [Estado de Implementación](#11-estado-de-implementación)
12. [Áreas de Mejora Identificadas](#12-áreas-de-mejora-identificadas)
13. [Glosario y Conceptos Clave](#13-glosario-y-conceptos-clave)

---

## 1. Visión General del Proyecto

### 1.1 ¿Qué es CourseForge?

**CourseForge** (anteriormente conocido como "Aprende y Aplica" o "Chat-Bot-LIA") es una **plataforma de creación automatizada de cursos educativos con IA integrada**. El sistema utiliza inteligencia artificial avanzada para transformar una idea central en un curso completo con:

- Estructura curricular (syllabus)
- Planes instruccionales detallados
- Fuentes curadas y validadas
- Materiales educativos (guiones, lecturas, quizzes, ejercicios)
- Storyboards para producción de video
- Prompts para generación de B-roll

### 1.2 Características Principales

| Característica | Descripción |
|----------------|-------------|
| ✅ Generación Automatizada | Pipeline completo de creación de cursos con IA |
| ✅ Curaduría de Fuentes | Búsqueda y validación automática de fuentes educativas |
| ✅ Validación con IA | Controles de calidad automáticos en cada paso |
| ✅ HITL (Human-In-The-Loop) | Puntos de aprobación manual por coordinadores |
| ✅ Producción Visual | Herramientas para crear slides y videos |
| ✅ Monorepo | Arquitectura escalable con workspaces de npm |
| ✅ Real-time Updates | Actualizaciones en tiempo real con Supabase |

### 1.3 Flujo de Trabajo General

```
📝 Idea Central
    ↓
🔷 Paso 1: Generación de Artefacto (nombres, objetivos, descripción)
    ↓
📋 Paso 2: Generación de Syllabus (estructura modular)
    ↓
📚 Paso 3: Plan Instruccional (detalles por lección)
    ↓
🔍 Paso 4: Curaduría de Fuentes (búsqueda y validación)
    ↓
✏️ Paso 5: Generación de Materiales (guiones, quizzes, etc.)
    ↓
🎬 Paso 6: Producción Visual (slides, videos)
```

---

## 2. Stack Tecnológico

### 2.1 Tecnologías Core

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COURSEFORGE - STACK TECNOLÓGICO (2026)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FRONTEND (apps/web)              BACKEND (apps/api)                        │
│  ├─ Next.js 16.1.3               ├─ Express 4.18.2                         │
│  ├─ React 19.2.3                 ├─ Node.js 22+                            │
│  ├─ TypeScript 5.9.3             ├─ TypeScript 5.9.3                       │
│  ├─ TailwindCSS 4.1.18           ├─ Zod 3.25.76                            │
│  ├─ Zustand 5.0.10               ├─ Supabase JS                            │
│  ├─ Axios 1.13.2                 ├─ Helmet 7.1.0                           │
│  ├─ Framer Motion 12.26.2        ├─ Morgan 1.10.0                          │
│  ├─ Lucide React 0.562.0         └─ CORS 2.8.5                             │
│  └─ clsx + tailwind-merge                                                   │
│                                                                             │
│  INTEGRACIONES IA                 INFRAESTRUCTURA                           │
│  ├─ @google/genai 1.38.0         ├─ Supabase (BaaS)                        │
│  ├─ @ai-sdk/google 3.0.10        ├─ Netlify (Hosting + Functions)          │
│  ├─ @ai-sdk/openai 3.0.12        ├─ PostgreSQL (via Supabase)              │
│  ├─ OpenAI 6.16.0                └─ GitHub (Version Control)               │
│  └─ Gemini 2.0/2.5 Models                                                   │
│                                                                             │
│  SHARED PACKAGES                  HERRAMIENTAS                              │
│  ├─ @courseforge/shared          ├─ npm workspaces                         │
│  └─ @courseforge/ui              ├─ Concurrently 8.2.2                     │
│                                   ├─ ESLint 9.39.2                          │
│                                   ├─ Prettier 3.8.0                         │
│                                   └─ Netlify CLI 23.13.3                    │
│                                                                             │
│  UTILIDADES                       PROCESAMIENTO                             │
│  ├─ Sonner (toasts)              ├─ Cheerio (web scraping)                 │
│  ├─ next-themes (dark mode)      ├─ html-to-image                          │
│  └─ react-markdown               └─ SCORM-again (LMS)                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

REQUISITOS DEL SISTEMA:
├─ Node.js >= 22.0.0
└─ npm >= 10.5.1
```

### 2.2 Dependencias Principales

#### Frontend (`apps/web/package.json`)

```json
{
  "dependencies": {
    "@courseforge/shared": "*",
    "@courseforge/ui": "*",
    "@google/genai": "^1.38.0",
    "@netlify/functions": "^5.1.2",
    "@supabase/ssr": "latest",
    "@supabase/supabase-js": "latest",
    "axios": "^1.13.2",
    "clsx": "^2.1.0",
    "framer-motion": "^12.26.2",
    "lucide-react": "^0.562.0",
    "next": "^16.1.3",
    "next-themes": "^0.4.6",
    "react": "^19.2.3",
    "react-dom": "^19.2.3",
    "sonner": "^2.0.7",
    "tailwind-merge": "^2.2.0",
    "zustand": "^5.0.10"
  }
}
```

#### Backend (`apps/api/package.json`)

```json
{
  "dependencies": {
    "express": "4.18.2",
    "cors": "2.8.5",
    "helmet": "7.1.0",
    "morgan": "1.10.0",
    "dotenv": "16.4.1",
    "zod": "3.25.76",
    "@courseforge/shared": "*"
  }
}
```

### 2.3 Configuración de Despliegue

**Netlify (`netlify.toml`)**:
```toml
[build]
  command = "npm run build -w apps/web"
  publish = "apps/web/.next"

[dev]
  command = "npm run dev -w apps/web"
  framework = "next"
  targetPort = 3000

[[plugins]]
  package = "@netlify/plugin-nextjs"

[functions]
  directory = "apps/web/netlify/functions"
```

---

## 3. Arquitectura del Sistema

### 3.1 Estructura del Monorepo

```
courseforge/
│
├── apps/                          # Aplicaciones principales
│   ├── web/                       # Frontend (Next.js 16)
│   │   ├── src/
│   │   │   ├── app/               # Next.js App Router
│   │   │   ├── components/        # Componentes globales
│   │   │   ├── config/            # Configuración
│   │   │   ├── core/              # Servicios y stores
│   │   │   ├── domains/           # Dominios de negocio
│   │   │   ├── features/          # Features del negocio
│   │   │   ├── lib/               # Utilidades y servicios
│   │   │   ├── shared/            # Componentes compartidos
│   │   │   └── utils/             # Utilidades
│   │   ├── netlify/
│   │   │   └── functions/         # Funciones serverless
│   │   ├── public/                # Assets estáticos
│   │   └── package.json
│   │
│   └── api/                       # Backend (Express)
│       ├── src/
│       │   └── server.ts          # Entry point
│       └── package.json
│
├── packages/                      # Paquetes compartidos
│   ├── shared/                    # @courseforge/shared
│   │   ├── src/
│   │   └── package.json
│   └── ui/                        # @courseforge/ui
│       ├── src/
│       └── package.json
│
├── docs/                          # Documentación del proyecto
│   ├── ARQUITECTURA-COMPLETA.md
│   ├── ESTADO_FASE_5_MATERIALES.md
│   ├── ESTADO_FASE_6_SLIDES.md
│   ├── DESIGN_SYSTEM.md
│   └── [otros documentos]
│
├── supabase/                      # Base de datos
│   ├── migrations/                # Migraciones SQL
│   ├── Scripts/                   # Scripts de BD
│   └── data/                      # Datos de seed
│
├── scripts/                       # Scripts de utilidad
│
├── package.json                   # Configuración del monorepo
├── netlify.toml                   # Configuración de Netlify
└── BD.sql                         # Schema completo de BD
```

### 3.2 Screaming Architecture

El proyecto implementa **Screaming Architecture** donde la estructura de carpetas "grita" sobre el dominio del negocio:

```
src/domains/
├── curation/           # 🔍 Curaduría de fuentes
│   ├── components/
│   ├── hooks/
│   ├── services/
│   └── types/
│
├── instructionalPlan/  # 📚 Plan instruccional
│   ├── components/
│   ├── hooks/
│   └── services/
│
├── materials/          # ✏️ Materiales educativos
│   ├── components/
│   ├── hooks/
│   ├── services/
│   ├── types/
│   └── validators/
│
├── plan/               # 📋 Planificación
│   └── [componentes]
│
├── prompts/            # 💬 Gestión de prompts
│   └── [componentes]
│
└── syllabus/           # 📝 Syllabus
    ├── components/
    ├── hooks/
    └── services/
```

### 3.3 Reglas de Dependencias

```
┌─────────────┐
│  domains/   │  ← Puede importar de core/, shared/, lib/
└──────┬──────┘
       │
       ↓
┌─────────────┐
│    core/    │  ← Puede importar de shared/, lib/
└──────┬──────┘
       │
       ↓
┌─────────────┐
│   shared/   │  ← NO puede importar de otros
└─────────────┘
```

---

## 4. Modelo de Datos (Base de Datos)

### 4.1 Diagrama de Entidades

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   artifacts     │────→│    syllabus     │     │  organizations  │
│  (curso base)   │     │   (estructura)  │     │  (empresas)     │
└────────┬────────┘     └─────────────────┘     └────────┬────────┘
         │                                                │
         │              ┌─────────────────┐              │
         ├─────────────→│instructional_   │              │
         │              │    plans        │              │
         │              │ (plan detalles) │              │
         │              └─────────────────┘              │
         │                                                │
         │              ┌─────────────────┐     ┌────────┴────────┐
         ├─────────────→│    curation     │     │    profiles     │
         │              │ (control fuent.)│     │    (usuarios)   │
         │              └────────┬────────┘     └─────────────────┘
         │                       │
         │              ┌────────┴────────┐
         │              │ curation_rows   │
         │              │ (cada fuente)   │
         │              └─────────────────┘
         │
         │              ┌─────────────────┐
         └─────────────→│   materials     │
                        │ (materiales)    │
                        └────────┬────────┘
                                 │
                        ┌────────┴────────┐
                        │material_lessons │
                        │ (por lección)   │
                        └────────┬────────┘
                                 │
                        ┌────────┴────────┐
                        │material_         │
                        │  components     │
                        │(guiones, quiz) │
                        └─────────────────┘
```

### 4.2 Tablas Principales

#### `artifacts` - Artefactos (Cursos)
```sql
CREATE TABLE public.artifacts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  run_id text,
  course_id text,
  idea_central text NOT NULL,
  nombres jsonb NOT NULL DEFAULT '[]'::jsonb,
  objetivos jsonb NOT NULL DEFAULT '[]'::jsonb,
  descripcion jsonb NOT NULL DEFAULT '{}'::jsonb,
  state artifact_state NOT NULL DEFAULT 'DRAFT',
  validation_report jsonb,
  semantic_result jsonb,
  auto_retry_count integer NOT NULL DEFAULT 0,
  iteration_count integer NOT NULL DEFAULT 0,
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

**Estados del Artefacto**:
- `DRAFT` - Borrador inicial
- `VALIDATED` - Validado
- `APPROVED` - Aprobado

#### `syllabus` - Estructura del Curso
```sql
CREATE TABLE public.syllabus (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  route text NOT NULL DEFAULT 'B_NO_SOURCE',
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_summary jsonb,
  validation jsonb NOT NULL DEFAULT '{"checks": [], "automatic_pass": false}',
  qa jsonb NOT NULL DEFAULT '{"status": "PENDING"}',
  state text NOT NULL DEFAULT 'STEP_DRAFT',
  iteration_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

#### `instructional_plans` - Planes Instruccionales
```sql
CREATE TABLE public.instructional_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  lesson_plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  dod jsonb NOT NULL DEFAULT '{"checklist": [], "semantic_checks": [], "automatic_checks": []}',
  approvals jsonb NOT NULL DEFAULT '{"architect_status": "PENDING"}',
  final_status text,
  state text NOT NULL DEFAULT 'STEP_DRAFT',
  iteration_count integer NOT NULL DEFAULT 0,
  validation jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

#### `curation` - Control de Curaduría
```sql
CREATE TABLE public.curation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  attempt_number integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'PHASE2_DRAFT',
  qa_decision jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

#### `curation_rows` - Fuentes Curadas
```sql
CREATE TABLE public.curation_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  curation_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  component text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  source_ref text NOT NULL,
  source_title text,
  source_rationale text,
  url_status text NOT NULL DEFAULT 'PENDING',
  http_status_code integer,
  last_checked_at timestamp with time zone,
  failure_reason text,
  apta boolean,
  motivo_no_apta text,
  cobertura_completa boolean,
  notes text,
  auto_evaluated boolean DEFAULT false,
  auto_reason text,
  forbidden_override boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

#### `materials` - Materiales Generados
```sql
CREATE TABLE public.materials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  prompt_version text NOT NULL DEFAULT 'default',
  state text NOT NULL DEFAULT 'PHASE3_DRAFT',
  qa_decision jsonb,
  package jsonb,
  lessons jsonb DEFAULT '[]'::jsonb,
  global_blockers jsonb DEFAULT '[]'::jsonb,
  dod jsonb DEFAULT '{"checklist": [], "automatic_checks": []}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

**Estados de Materials**:
- `PHASE3_DRAFT` - Borrador inicial
- `PHASE3_GENERATING` - Generando materiales
- `PHASE3_VALIDATING` - Validando materiales
- `PHASE3_NEEDS_FIX` - Requiere correcciones
- `PHASE3_READY_FOR_QA` - Listo para QA
- `PHASE3_APPROVED` - Aprobado
- `PHASE3_REJECTED` - Rechazado

#### `material_lessons` - Lecciones de Materiales
```sql
CREATE TABLE public.material_lessons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  materials_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  module_id text NOT NULL,
  module_title text NOT NULL,
  oa_text text NOT NULL,
  expected_components text[] NOT NULL DEFAULT '{}',
  quiz_spec jsonb,
  requires_demo_guide boolean DEFAULT false,
  dod jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'PENDING',
  iteration_count integer NOT NULL DEFAULT 0,
  max_iterations integer NOT NULL DEFAULT 2,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

**Estados de Lección**:
- `PENDING` - Pendiente
- `GENERATING` - En generación
- `GENERATED` - Generado
- `APPROVABLE` - Listo para aprobar
- `NEEDS_FIX` - Requiere corrección

#### `material_components` - Componentes de Materiales
```sql
CREATE TABLE public.material_components (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  material_lesson_id uuid NOT NULL,
  type text NOT NULL,
  content jsonb NOT NULL,
  source_refs text[] DEFAULT '{}',
  validation_status text NOT NULL DEFAULT 'PENDING',
  validation_errors text[] DEFAULT '{}',
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  iteration_number integer NOT NULL DEFAULT 1,
  assets jsonb DEFAULT '{}'
);
```

**Tipos de Componentes**:
- `DIALOGUE` - Guión/Diálogo
- `READING` - Lectura
- `QUIZ` - Evaluación
- `EXERCISE` - Ejercicio
- `DEMO_GUIDE` - Guía de demostración
- `STORYBOARD` - Storyboard para video

### 4.3 Tablas de Soporte

#### `profiles` - Perfiles de Usuario
```sql
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text UNIQUE,
  email text,
  first_name text,
  last_name_father text,
  last_name_mother text,
  avatar_url text,
  platform_role app_role NOT NULL DEFAULT 'CONSTRUCTOR',
  organization_id uuid,
  organization_role text,
  is_active boolean DEFAULT true,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

#### `organizations` - Organizaciones
```sql
CREATE TABLE public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

#### `model_settings` - Configuración de Modelos IA
```sql
CREATE TABLE public.model_settings (
  id integer NOT NULL DEFAULT 1,
  model_name text NOT NULL DEFAULT 'gemini-2.0-flash',
  temperature numeric NOT NULL DEFAULT 0.20,
  is_active boolean DEFAULT true,
  fallback_model text NOT NULL DEFAULT 'gemini-2.0-flash',
  thinking_level text NOT NULL DEFAULT 'minimal',
  setting_type text DEFAULT 'SEARCH'
);
```

#### `system_prompts` - Prompts del Sistema
```sql
CREATE TABLE public.system_prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  content text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
```

---

## 5. Pipeline de Generación de Cursos

### 5.1 Visión General del Pipeline

El pipeline de CourseForge consta de **6 fases** bien definidas, cada una con sus propias validaciones y puntos de control:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE DE GENERACIÓN DE CURSOS                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📝 PASO 1: ARTEFACTO                                                       │
│  ├─ Input: Idea central del curso                                          │
│  ├─ Output: Nombres, objetivos, descripción                                │
│  └─ Función: generate-artifact-background.ts                               │
│                                                                             │
│  ↓                                                                          │
│                                                                             │
│  📋 PASO 2: SYLLABUS                                                        │
│  ├─ Input: Artefacto validado                                              │
│  ├─ Output: Estructura modular (módulos y lecciones)                       │
│  └─ Función: syllabus-generation-background.ts                             │
│                                                                             │
│  ↓                                                                          │
│                                                                             │
│  📚 PASO 3: PLAN INSTRUCCIONAL                                              │
│  ├─ Input: Syllabus aprobado                                               │
│  ├─ Output: Detalles por lección (OA, componentes, especificaciones)       │
│  ├─ Función: instructional-plan-background.ts                              │
│  └─ Validación: validate-plan-background.ts                                │
│                                                                             │
│  ↓                                                                          │
│                                                                             │
│  🔍 PASO 4: CURADURÍA DE FUENTES                                            │
│  ├─ Input: Plan instruccional                                              │
│  ├─ Output: Fuentes validadas por lección                                  │
│  ├─ Función: curation-background.ts + unified-curation-logic.ts            │
│  └─ Validación: validate-curation-background.ts                            │
│                                                                             │
│  ↓                                                                          │
│                                                                             │
│  ✏️ PASO 5: GENERACIÓN DE MATERIALES                                        │
│  ├─ Input: Plan + Fuentes curadas                                          │
│  ├─ Output: Guiones, lecturas, quizzes, storyboards                        │
│  ├─ Función: materials-generation-background.ts                            │
│  └─ Validación: validate-materials-background.ts                           │
│                                                                             │
│  ↓                                                                          │
│                                                                             │
│  🎬 PASO 6: PRODUCCIÓN VISUAL                                               │
│  ├─ Input: Materiales validados                                            │
│  ├─ Output: Slides (Gamma), prompts de video, screencasts                  │
│  └─ Función: video-prompts-generation.ts                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Detalle de Cada Paso

#### Paso 1: Generación de Artefacto

**Archivo**: `netlify/functions/generate-artifact-background.ts`

**Entrada**:
- Idea central del curso (texto libre)

**Salida**:
- Nombres sugeridos para el curso (3-5 opciones)
- Objetivos de aprendizaje generales
- Descripción del curso
- Metadata de generación

**Estados**:
- `DRAFT` → `GENERATING` → `VALIDATED` → `APPROVED`

---

#### Paso 2: Generación de Syllabus

**Archivo**: `netlify/functions/syllabus-generation-background.ts`

**Entrada**:
- Artefacto validado
- Ruta seleccionada (A_WITH_SOURCE / B_NO_SOURCE)

**Salida**:
- Estructura de módulos
- Lecciones por módulo
- Duración estimada
- Resumen de fuentes (si aplica)

**Estructura de Módulos** (JSON):
```json
{
  "modules": [
    {
      "id": "M1",
      "title": "Introducción",
      "lessons": [
        {
          "id": "1.1",
          "title": "Fundamentos básicos",
          "duration_minutes": 30,
          "objectives": ["..."]
        }
      ]
    }
  ]
}
```

---

#### Paso 3: Plan Instruccional

**Archivo**: `netlify/functions/instructional-plan-background.ts`

**Validación**: `netlify/functions/validate-plan-background.ts`

**Entrada**:
- Syllabus aprobado
- Artefacto base

**Salida por Lección**:
```typescript
interface LessonPlan {
  lesson_id: string;
  lesson_title: string;
  module_id: string;
  module_title: string;
  oa_text: string;              // Objetivo de Aprendizaje
  expected_components: string[]; // ['DIALOGUE', 'READING', 'QUIZ']
  quiz_spec: {
    num_questions: number;
    question_types: string[];
  };
  requires_demo_guide: boolean;
  resources_needed: string[];
}
```

---

#### Paso 4: Curaduría de Fuentes

**Archivos**:
- `netlify/functions/curation-background.ts` (entrada)
- `netlify/functions/unified-curation-logic.ts` (lógica principal)
- `netlify/functions/validate-curation-background.ts` (validación)

**Proceso**:
1. Buscar fuentes relevantes usando Gemini con grounding
2. Validar accesibilidad de URLs (HTTP status)
3. Evaluar calidad y relevancia de cada fuente
4. Marcar fuentes como `apta` o `no_apta`

**Campos de Validación**:
```typescript
interface CurationRow {
  source_ref: string;           // URL de la fuente
  source_title: string;
  source_rationale: string;     // Por qué es relevante
  url_status: 'PENDING' | 'OK' | 'FAILED';
  http_status_code: number;
  apta: boolean;
  motivo_no_apta: string;
  cobertura_completa: boolean;
  auto_evaluated: boolean;
}
```

---

#### Paso 5: Generación de Materiales

**Archivo**: `netlify/functions/materials-generation-background.ts`

**Validación**: `netlify/functions/validate-materials-background.ts`

**Características**:
- ✅ Generación por lotes (batch processing) con `BATCH_SIZE = 2`
- ✅ Delays entre lecciones (15s) y entre batches (60s)
- ✅ Retry logic con exponential backoff y jitter
- ✅ Fallback de modelos: `gemini-2.5-pro` → `gemini-2.5-flash` → `gemini-2.0-flash`
- ✅ Uso de fuentes curadas aptas
- ✅ IDs únicos garantizados

**Tipos de Componentes Generados**:

| Tipo | Descripción |
|------|-------------|
| `DIALOGUE` | Guión narrativo para video |
| `READING` | Material de lectura complementario |
| `QUIZ` | Preguntas de evaluación con respuestas |
| `EXERCISE` | Ejercicios prácticos |
| `DEMO_GUIDE` | Guía para demostraciones |
| `STORYBOARD` | Estructura visual para video |

**Controles de Validación**:
- **Control 3**: Consistencia con el plan (componentes esperados)
- **Control 4**: Uso de fuentes (parcialmente implementado)
- **Control 5**: Validación de quiz (preguntas y explicaciones)

---

#### Paso 6: Producción Visual

**Archivo**: `netlify/functions/video-prompts-generation.ts`

**Componentes UI**:
- `VisualProductionContainer.tsx`
- `ProductionAssetCard.tsx`

**Funcionalidades**:
- ✅ Copiar estructura de storyboard para Gamma
- ✅ Generar prompts de B-roll con IA
- ✅ Tracking de URLs de assets
- ✅ Gestión de screencasts

**Estructura de Assets**:
```typescript
interface MaterialAssets {
  slides_url?: string;      // URL de deck en Gamma
  b_roll_prompts?: string;  // Prompts para video IA
  video_url?: string;       // URL de video final
  screencast_url?: string;  // URL de screencast
}
```

---

## 6. Frontend - Aplicación Web

### 6.1 Estructura del App Router (Next.js 16)

```
apps/web/src/app/
├── layout.tsx              # Layout raíz con providers
├── page.tsx                # Homepage pública
├── globals.css             # Estilos globales
├── providers.tsx           # Providers de contexto
│
├── login/                  # Autenticación
│   ├── page.tsx
│   └── [componentes]
│
├── register/               # Registro
│   └── page.tsx
│
├── dashboard/              # Dashboard general
│   └── page.tsx
│
├── admin/                  # Panel de administración
│   ├── layout.tsx
│   ├── page.tsx            # Dashboard admin
│   ├── AdminLayoutClient.tsx
│   ├── SidebarNav.tsx
│   │
│   ├── artifacts/          # Gestión de artefactos
│   │   ├── page.tsx
│   │   └── [id]/           # Detalle de artefacto
│   │       └── ArtifactClientView.tsx
│   │
│   ├── profile/            # Perfil de usuario
│   │   └── [componentes]
│   │
│   ├── settings/           # Configuración
│   │   └── [componentes]
│   │
│   └── users/              # Gestión de usuarios
│       └── [componentes]
│
└── api/                    # API Routes (Next.js)
    └── [endpoints]
```

### 6.2 Dominios de Negocio

```
apps/web/src/domains/
├── curation/               # Curaduría de fuentes
│   ├── components/
│   │   ├── CurationTable.tsx
│   │   ├── CurationRowCard.tsx
│   │   ├── CurationValidation.tsx
│   │   └── index.ts
│   ├── hooks/
│   │   └── useCuration.ts
│   ├── services/
│   │   └── curation.service.ts
│   └── types/
│       └── curation.types.ts
│
├── instructionalPlan/      # Plan instruccional
│   ├── components/
│   ├── hooks/
│   └── services/
│
├── materials/              # Materiales educativos
│   ├── components/
│   │   ├── LessonMaterialsCard.tsx
│   │   ├── MaterialComponentViewer.tsx
│   │   ├── VisualProductionContainer.tsx
│   │   ├── ProductionAssetCard.tsx
│   │   └── [otros componentes]
│   ├── hooks/
│   │   └── useMaterials.ts
│   ├── services/
│   │   └── materials.service.ts
│   ├── types/
│   │   └── materials.types.ts
│   └── validators/
│       └── materials.validators.ts
│
├── plan/                   # Planificación general
├── prompts/                # Gestión de prompts
└── syllabus/               # Syllabus
    ├── components/
    ├── hooks/
    └── services/
```

### 6.3 Componentes Compartidos

```
apps/web/src/shared/
├── components/
│   ├── Button/
│   ├── Card/
│   ├── Input/
│   └── Modal/
│
├── config/
│   └── prompts/            # Prompts de IA
│
├── types/
│   └── common.types.ts
│
└── utils/
    └── cn.ts               # Utility para classnames
```

### 6.4 Servicios de IA (LIA)

```
apps/web/src/lib/
├── lia-app-context.ts      # Contexto de aplicación para IA
├── lia-db-context.ts       # Contexto de BD para IA
├── lia-dom-mapper.ts       # Mapeo de DOM para IA
├── lia-service.ts          # Servicio principal de IA
└── utils.ts                # Utilidades
```

---

## 7. Backend - API y Funciones

### 7.1 Funciones Netlify (Serverless)

```
apps/web/netlify/functions/
│
├── generate-artifact-background.ts     # Paso 1: Generación artefacto
├── syllabus-generation-background.ts   # Paso 2: Generación syllabus
├── instructional-plan-background.ts    # Paso 3: Plan instruccional
├── validate-plan-background.ts         # Validación paso 3
├── curation-background.ts              # Paso 4: Entrada curaduría
├── unified-curation-logic.ts           # Paso 4: Lógica curaduría
├── validate-curation-background.ts     # Validación paso 4
├── materials-generation-background.ts  # Paso 5: Generación materiales
├── validate-materials-background.ts    # Validación paso 5
└── video-prompts-generation.ts         # Paso 6: Prompts de video
```

### 7.2 Patrones de Implementación

#### Background Functions

Las funciones background permiten ejecución de larga duración (hasta 15 minutos):

```typescript
// Ejemplo de estructura de función background
export const handler = async (event: any) => {
  try {
    // 1. Parsear input
    const { artifactId } = JSON.parse(event.body);
    
    // 2. Obtener datos de Supabase
    const supabase = createClient();
    const { data } = await supabase.from('artifacts').select('*').eq('id', artifactId);
    
    // 3. Procesar con IA
    const result = await processWithGemini(data);
    
    // 4. Guardar resultados
    await supabase.from('materials').update(result).eq('artifact_id', artifactId);
    
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
```

#### Retry con Exponential Backoff

```typescript
async function callWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.status === 429 || error.status === 503) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}
```

#### Model Fallback Chain

```typescript
const MODELS = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'];

async function generateWithFallback(prompt: string) {
  for (const model of MODELS) {
    try {
      return await generateWithModel(model, prompt);
    } catch (error) {
      console.log(`Model ${model} failed, trying next...`);
      continue;
    }
  }
  throw new Error('All models failed');
}
```

### 7.3 Express API (Backend)

```
apps/api/src/
├── server.ts               # Entry point
└── [features]/             # Features por dominio
```

**Estructura del servidor**:
```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4000, () => {
  console.log('API running on port 4000');
});
```

---

## 8. Sistema de Diseño

### 8.1 Paleta de Colores

#### Modo Oscuro (Principal)

| Variable | Valor HSL | Hex | Uso |
|----------|-----------|-----|-----|
| `--background` | hsl(210 25% 8%) | #0F1419 | Fondo global |
| `--card` | hsl(213 16% 14%) | #1E2329 | Fondo tarjetas |
| `--border` | hsl(213 16% 25%) | #2D3339 | Bordes |
| `--primary` | hsl(215 90% 35%) | - | Azul primario |
| `--accent-teal` | hsl(171 100% 42%) | #00D4B3 | Teal Sofia |
| `--success` | hsl(160 84% 39%) | #10B981 | Verde (Emerald) |
| `--warning` | hsl(38 92% 50%) | #F59E0B | Naranja (Amber) |
| `--destructive` | hsl(0 84.2% 60.2%) | #EF4444 | Rojo |

### 8.2 Componentes UI

#### Botones

```css
/* Primario */
.btn-primary {
  background: var(--gradient-button-primary);
  border-radius: 0.75rem;
  box-shadow: 0 0 20px rgba(31, 90, 246, 0.3);
}

/* Secundario */
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
}

/* Ghost */
.btn-ghost {
  background: transparent;
  border: none;
}
```

#### Tarjetas

```css
.card-premium {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 16px;
  padding: 1.5rem;
  transition: all 0.2s ease;
}

.card-premium:hover {
  border-color: hsl(var(--primary) / 0.5);
  transform: translateY(-2px);
  box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
}
```

### 8.3 Layout del Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Header: Logo + Título + Acciones Globales                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────────┐ │
│  │ Zona A: Panel Principal (70%)  │ │ Zona B: Panel Lateral (30%)        │ │
│  │                                 │ │                                     │ │
│  │ ┌─────┬─────┬─────┬─────┐      │ │ ┌─────────────────────────────────┐ │ │
│  │ │KPI 1│KPI 2│KPI 3│KPI 4│      │ │ │ Actividad Reciente              │ │ │
│  │ └─────┴─────┴─────┴─────┘      │ │ │ ├─ Evento 1                     │ │ │
│  │                                 │ │ │ ├─ Evento 2                     │ │ │
│  │ ┌─────────────────────────────┐ │ │ │ └─ Evento 3                     │ │ │
│  │ │ Tabla Artefactos Recientes  │ │ │ └─────────────────────────────────┘ │ │
│  │ │                             │ │ │                                     │ │
│  │ │                             │ │ │ ┌─────────────────────────────────┐ │ │
│  │ │                             │ │ │ │ Estado del Sistema              │ │ │
│  │ └─────────────────────────────┘ │ │ └─────────────────────────────────┘ │ │
│  └─────────────────────────────────┘ └─────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Integraciones de IA

### 9.1 Modelos Utilizados

| Modelo | Uso Principal | Fallback |
|--------|--------------|----------|
| `gemini-2.5-pro` | Generación compleja | ✓ |
| `gemini-2.5-flash` | Generación rápida | ✓ |
| `gemini-2.0-flash` | Fallback final | - |

### 9.2 Configuración de Modelos

```typescript
// model_settings table
{
  model_name: 'gemini-2.0-flash',
  temperature: 0.20,
  fallback_model: 'gemini-2.0-flash',
  thinking_level: 'minimal', // 'minimal' | 'low' | 'medium' | 'high'
  setting_type: 'SEARCH'     // Tipo de operación
}
```

### 9.3 Flujo de Generación con IA

```
┌─────────────────┐
│   User Input    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  System Prompt  │ ← Carga de `system_prompts` table
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Gemini API    │
│   with Tools    │ ← Grounding Search, URL Context
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Validation     │ ← Zod schemas
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Save to DB    │
└─────────────────┘
```

### 9.4 Prompts del Sistema

Los prompts se almacenan en la tabla `system_prompts` y se cargan dinámicamente:

```typescript
interface SystemPrompt {
  code: string;           // 'ARTIFACT_GENERATION', 'SYLLABUS_GENERATION', etc.
  version: string;        // '1.0.0'
  content: string;        // El prompt completo
  description: string;
  is_active: boolean;
}
```

---

## 10. Estructura de Archivos

### 10.1 Archivos de Documentación Existentes

```
docs/
├── ARQUITECTURA-COMPLETA.md          # Guía de arquitectura detallada
├── DESIGN_SYSTEM.md                   # Sistema de diseño visual
├── ESTADO_FASE_5_MATERIALES.md        # Estado de implementación Fase 5
├── ESTADO_FASE_6_SLIDES.md            # Estado de implementación Fase 6
├── RESUMEN_FASES_5_Y_6.md             # Resumen de fases
├── DOCUMENTACION_DESARROLLO.md        # Guía de desarrollo
├── DOCUMENTACION_PASO_2_*.md          # Documentación por paso
├── DOCUMENTACION_PASO_3_*.md
├── DOCUMENTACION_TECNICA_PASO_4_*.md
├── DOCUMENTACION_PASO_6_*.md
├── ANALISIS_PASO_4.md                 # Análisis detallado
├── ANALISIS_Y_PROMPTS_PASO_05.md
├── PLAN_IMPLEMENTACION_*.md           # Planes de implementación
├── Prompt*_adaptado.md                # Prompts adaptados
├── resumen ejecutivo.md               # Resumen ejecutivo completo
├── integracion.md                     # Guía de integración
└── [otros archivos de documentación]
```

### 10.2 Scripts de Base de Datos

```
supabase/
├── migrations/                        # Migraciones SQL
│   └── [TIMESTAMP]_[descripcion].sql
│
├── Scripts/                           # Scripts de utilidad
│   ├── material_lessons.sql
│   ├── material_components.sql
│   └── [otros scripts]
│
└── data/                              # Datos de seed
    └── [archivos de seed]
```

### 10.3 Archivos de Configuración

```
courseforge/
├── package.json                       # Monorepo principal
├── netlify.toml                       # Configuración Netlify
├── .gitignore                         # Git ignore
├── .env                               # Variables de entorno (no versionar)
├── BD.sql                             # Schema completo de BD
└── apps/web/
    ├── next.config.ts                 # Configuración Next.js
    ├── tailwind.config.ts             # Configuración Tailwind
    ├── tsconfig.json                  # TypeScript config
    └── postcss.config.js              # PostCSS config
```

---

## 11. Estado de Implementación

### 11.1 Resumen por Fase

| Fase | Nombre | Estado | Completitud |
|------|--------|--------|-------------|
| 1 | Generación de Artefacto | ✅ Implementado | ~90% |
| 2 | Generación de Syllabus | ✅ Implementado | ~90% |
| 3 | Plan Instruccional | ✅ Implementado | ~85% |
| 4 | Curaduría de Fuentes | ✅ Implementado | ~80% |
| 5 | Generación de Materiales | 🟡 Parcial | ~70% |
| 6 | Producción Visual | 🟡 Parcial | ~40% |

### 11.2 Detalle de Fase 5 (Materiales)

#### ✅ Implementado
- Generación con IA por lotes
- Retry logic con exponential backoff
- Fallback entre modelos
- Validación de consistencia (Control 3)
- Validación de quiz (Control 5)
- IDs únicos garantizados
- Real-time updates
- Servicios frontend

#### ❌ No Implementado
- Iteración dirigida completa
- Control 4 completo (validación de fuentes)
- Bloqueo por URLs rotas
- UI de checklist HITL
- Gestión de bloqueadores
- Empaquetado y naming
- QA consolidado
- Audit log completo

### 11.3 Detalle de Fase 6 (Producción Visual)

#### ✅ Implementado
- UI de producción visual
- Gestión de assets por componente
- Persistencia de URLs
- Generación de prompts B-roll
- Tracking de URLs de Gamma
- Gestión de screencasts

#### ❌ No Implementado
- Integración directa con Gamma
- Export a PNG automatizado
- Validaciones DoD de slides
- Estados del workflow
- Vista de QA
- Gestión de errores típicos
- Tracking y audit log
- Política de escalamiento

---

## 12. Áreas de Mejora Identificadas

### 12.1 Prioridad Alta 🔴

| Área | Descripción | Impacto |
|------|-------------|---------|
| **Control 4 Completo** | Validar uso correcto de fuentes aptas | Calidad del contenido |
| **Iteración Dirigida** | Permitir correcciones específicas sin regenerar todo | Eficiencia |
| **UI de Checklist HITL** | Validación manual por operador | Control de calidad |
| **Vista QA Consolidada** | Flujo de aprobación/rechazo | Proceso de producción |
| **Integración Gamma** | Decisión técnica: RPA vs HITL vs API | Producción visual |

### 12.2 Prioridad Media 🟡

| Área | Descripción | Impacto |
|------|-------------|---------|
| **Gestión de Bloqueadores** | Tracking de impedimentos | Coordinación |
| **Validación de URLs** | Prevenir errores de fuentes rotas | Fiabilidad |
| **Audit Log Completo** | Trazabilidad total | Debugging |
| **Estados del Workflow** | State machine completa para Fase 6 | Tracking |
| **Estándar PNG Export** | Definir resolución, naming, estructura | Producción |

### 12.3 Prioridad Baja 🟢

| Área | Descripción | Impacto |
|------|-------------|---------|
| **Empaquetado y Naming** | Organización de outputs | Orden |
| **Snapshots de Config** | Auditoría de configuraciones | Trazabilidad |
| **Tabla phase3_validations** | Historial de validaciones | Histórico |
| **Dashboard de Métricas** | Visualización de estadísticas | Insights |

### 12.4 Decisiones Técnicas Pendientes

1. **Integración con Gamma**:
   - Opción A: RPA (Playwright) - Totalmente automático pero frágil
   - Opción B: HITL - Manual pero flexible
   - Opción C: API de Gamma - Robusto si está disponible

2. **Estándar de Export PNG**:
   - Resolución (1920x1080 vs 4K)
   - Naming de archivos (`T1-M1-V1-slide-001.png`)
   - Estructura de carpetas

3. **Sistema de Tracking**:
   - Solo sistema interno
   - Solo Coda
   - Híbrido con sincronización

---

## 13. Glosario y Conceptos Clave

### 13.1 Términos del Dominio

| Término | Definición |
|---------|------------|
| **Artefacto** | Entidad principal que representa un curso en desarrollo |
| **Syllabus** | Estructura modular del curso (módulos y lecciones) |
| **Plan Instruccional** | Detalle pedagógico por lección (OA, componentes, especificaciones) |
| **Curaduría** | Proceso de búsqueda y validación de fuentes educativas |
| **OA** | Objetivo de Aprendizaje |
| **DoD** | Definition of Done - Criterios de completitud |
| **HITL** | Human-In-The-Loop - Intervención humana en el proceso |

### 13.2 Componentes de Materiales

| Tipo | Descripción |
|------|-------------|
| **DIALOGUE** | Guión narrativo para video teórico |
| **READING** | Material de lectura complementario |
| **QUIZ** | Preguntas de evaluación con respuestas y explicaciones |
| **EXERCISE** | Ejercicios prácticos para el estudiante |
| **DEMO_GUIDE** | Guía para demostraciones técnicas |
| **STORYBOARD** | Estructura visual para producción de video |

### 13.3 Estados del Sistema

| Estado | Significado |
|--------|-------------|
| `DRAFT` | Borrador inicial |
| `GENERATING` | En proceso de generación |
| `VALIDATING` | En proceso de validación |
| `VALIDATED` | Validado exitosamente |
| `APPROVED` | Aprobado por QA/Coordinación |
| `REJECTED` | Rechazado, requiere corrección |
| `NEEDS_FIX` | Identificado para corrección |
| `PENDING` | Pendiente de acción |
| `APPROVABLE` | Cumple criterios, listo para aprobar |

### 13.4 Roles del Sistema

| Rol | Responsabilidades |
|-----|-------------------|
| **CONSTRUCTOR** | Crea y edita artefactos |
| **ARCHITECT** | Diseña estructura curricular |
| **QA** | Valida y aprueba contenidos |
| **ADMIN** | Administra usuarios y configuración |

---

## 📎 Apéndices

### A. Comandos Útiles

```bash
# Desarrollo local
npm run dev                    # Ejecuta frontend + backend

# Solo frontend
npm run dev -w apps/web

# Solo backend
npm run dev -w apps/api

# Build de producción
npm run build

# Linting
npm run lint

# Netlify dev (con funciones)
netlify dev
```

### B. Variables de Entorno Requeridas

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google AI
GOOGLE_GENERATIVE_AI_API_KEY=

# OpenAI (opcional)
OPENAI_API_KEY=

# Aplicación
NEXT_PUBLIC_APP_URL=
```

### C. Estructura de Migraciones

Las migraciones de Supabase siguen el formato:
```
YYYYMMDDHHMMSS_descripcion.sql
```

Ejemplo: `20260123120000_add_assets_to_material_components.sql`

---

> **Documento generado automáticamente** para análisis con herramientas externas.
> 
> Última actualización: Enero 2026
> 
> Para más detalles, consultar la documentación en la carpeta `/docs/`
