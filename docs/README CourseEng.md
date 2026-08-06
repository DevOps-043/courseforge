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

1.  **NO A LA ALUCINACIÓN**: A diferencia de ChatGPT, CourseEngine _no inventa_ hechos. Utiliza un motor de curaduría (Fase 4) que busca referencias reales, verifica que las URLs funcionen (HTTP 200) y valida que el contenido sea relevante antes de usarlo para escribir.
2.  **ESTRUCTURA PRIMERO, CONTENIDO DESPUÉS**: No se genera texto hasta que no haya un plan instruccional aprobado (Fase 3). Esto asegura coherencia pedagógica.
3.  **HUMAN-IN-THE-LOOP (HITL)**: El sistema está diseñado para detenerse entre fases críticas, permitiendo que un experto humano revise y apruebe el syllabus o las fuentes antes de continuar.

---

## 🏗 Arquitectura Técnica

El proyecto es un **Monorepo** gestionado con npm workspaces, implementando "Screaming Architecture" donde la estructura de carpetas refleja el dominio del negocio.

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

### Tecnologías Clave

- **Frontend**: React 19, TailwindCSS 4, Framer Motion.
- **Orquestación**: Netlify Functions (Node.js 20+).
- **Base de Datos**: Supabase (PostgreSQL 15) con extensión `vector` habilitada.
- **IA**: Google Generative AI (`gemini-2.0-flash`, `gemini-1.5-pro`) y OpenAI como fallback.

---

## 🔄 El Pipeline "Lia"

Cada curso pasa por una secuencia estricta de 6 fases. A continuación se detalla la lógica interna de cada una.

### Fase 1: Artefacto y Concepto

**Objetivo**: Transformar una intención vaga ("quiero un curso de ventas") en una ficha técnica sólida.

- **Entrada**: String de texto (la idea del usuario).
- **Proceso (`generate-artifact-background.ts`)**:
  1.  Analiza la intención del usuario.
  2.  Genera 3-5 variantes de títulos comerciales.
  3.  Define el **Público Objetivo** y los **Prerrequisitos**.
  4.  Redacta los **Objetivos de Aprendizaje (OA)** usando verbos de la Taxonomía de Bloom.
- **Salida**: Registro en tabla `artifacts`.
- **Validación**: Verifica que la descripción tenga >50 palabras y coincida semánticamente con el título.

### Fase 2: Syllabus y Estructura

**Objetivo**: Crear el esqueleto jerárquico del curso.

- **Entrada**: ID del Artefacto validado.
- **Proceso (`syllabus-generation-background.ts`)**:
  - Toma los OAs definidos en la Fase 1.
  - Propone una estructura de **Módulos** (agrupadores temáticos).
  - Dentro de cada módulo, define **Lecciones** secuenciales.
  - Asigna tiempos estimados (e.g., "15 min") a cada lección.
- **Salida**: JSON estructurado en tabla `syllabus`.

### Fase 3: Planificación Instruccional

**Objetivo**: El "Cerebro Pedagógico". Decide CÓMO enseñar cada tema.

- **Entrada**: Syllabus aprobado.
- **Proceso (`instructional-plan-background.ts`)**:
  - Itera sobre cada lección del syllabus.
  - Basado en la complejidad del tema, asigna **Componentes**:
    - _Es un concepto teórico?_ -> Asigna `READING` (Lectura).
    - _Es un proceso paso a paso?_ -> Asigna `DEMO_GUIDE` o `VIDEO_SCRIPT`.
    - _Requiere verificación?_ -> Asigna `QUIZ` o `EXERCISE`.
- **Lógica Crítica**:
  - No permite lecciones vacías (sin componentes).
  - Asegura variedad didáctica (no solo lecturas).

### Fase 4: Curaduría e Investigación Deep

**Objetivo**: Encontrar la verdad. **Esta es la fase más compleja y crítica.**

- **Archivo Principal**: `apps/web/netlify/functions/unified-curation-logic.ts`
- **Lógica de Ejecución**:
  1.  **Batch Processing**: Procesa lecciones en lotes de 2 para evitar saturar la API y timeouts.
  2.  **Context Injection**: Inyecta el título del curso y descripción en el prompt del sistema para asegurar relevancia.
  3.  **Google Grounding**: Utiliza la herramienta de búsqueda de Google integrada en Gemini para encontrar URLs candidatas.

#### Sub-proceso de Validación de Fuentes (`validateUrlWithContent`)

Antes de aceptar una URL, el sistema realiza una "autopsia" HTTP:

1.  **Check de Conectividad**: Hace una petición `HEAD` o `GET`. Si devuelve 404, 403 o 500, se descarta INMEDIATAMENTE.
2.  **Detección de "Soft 404"**: Analiza el HTML buscando frases como "Page not found" o "No se encuentra", incluso si el status es 200.
3.  **Detección de Paywalls**: Busca patrones como "Subscribe to read" o "Sign in". Se descartan.
4.  **Longitud de Contenido**: Si el texto extraído es < 500 caracteres, se considera "thin content" y se descarta.
5.  **Blacklist de Dominios**: Se bloquean automáticamente dominios no educativos (Reddit, Twitter, Facebook, TikTok, Quora) definidos en la constante `BLOCKED_DOMAINS`.

- **Salida**: Un set de filas en `curation_rows` marcadas como `apta=true` o `apta=false` con su justificación.

### Fase 5: Generación de Materiales

**Objetivo**: Redacción final de los contenidos usando las fuentes validadas.

- **Archivo Principal**: `apps/web/netlify/functions/materials-generation-background.ts`
- **Modo de Operación**: "Daisy Chain" (Cadena de Margaritas).
  - Debido a que generar un guión de video toma ~30-60 segundos, no se puede hacer todo en una sola petición HTTP.
  - El sistema usa un patrón recursivo: La función procesa UNA lección, guarda el estado, y se "auto-invoca" (`check-next`) para procesar la siguiente.
- **Lógica de Reintentos y Fallback**:
  - Intenta primero con **Gemini 2.5 Flash** (rápido).
  - Si falla o se satura (429), espera y reintenta.
  - Si persiste, baja a **Gemini 2.0 Flash** o **1.5 Pro**.
- **Prompt Engineering**:
  - Se construye un prompt masivo que incluye:
    - El perfil del "Experto" (definido en el sistema).
    - El Objetivo de Aprendizaje exacto.
    - El texto completo extraído de las fuentes curadas en Fase 4.
    - Las reglas de formato (JSON estricto).
- **Salida**: JSON guardado en `material_components` (separado por tipos: `DIALOGUE`, `QUIZ`, `READING`).

### Fase 6: Producción Visual

**Objetivo**: Preparar activos multimedia.

- Utiliza los guiones generados en Fase 5 para crear prompts de imagen (para DALL-E o Midjourney) que ilustren los conceptos.
- Genera estructura para diapositivas (exportables a Gamma.app o PowerPoint).

---

## 🗄 Modelo de Datos

Las tablas principales en Supabase están diseñadas para mantener la integridad referencial y el historial.

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

Para ver logs detallados del backend en desarrollo:

- La terminal donde corre `npm run dev` mostrará los `console.log` del backend con prefijos como `[Lesson Curation]`.
- Busca mensajes como `✓` para éxitos y `✗` para fallos de validación.

---

**CourseEngine** - _Ingeniería Educativa Automatizada_
