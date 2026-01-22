# Plan de Implementación: Paso 4 (Curaduría de Fuentes) - Nuevo Sistema (Alineado a CSVs)

Este documento detalla la implementación técnica del **Paso 4: Curaduría de Fuentes** en el nuevo sistema CourseForge, adaptando la robustez lógica del sistema anterior a la nueva arquitectura moderna (Next.js App Router, Server Actions, Supabase) y **alineando el modelo de datos estrictamente al sistema anterior para permitir la importación de CSVs históricos**.

---

## 1. Resumen de Funcionalidad

El objetivo es generar, validar y curar fuentes externas para cada componente educativo definido en el **Plan Instruccional (Paso 3)**.

---

## 2. Modelo de Datos (Supabase) - **Estricto**

Para garantizar compatibilidad con los archivos `.csv` exportados (`curation_rows.csv` y `curation_rows_rows.csv`), utilizaremos **exactamente** las mismas tablas y nombres de columnas.

### 2.1. Tabla `curation`

Corresponde a la cabecera de la ejecución (o `curation_runs`).
_Archivo CSV asociado: `curation_rows.csv`_

| Columna          | Tipo        | Descripción                                                 |
| :--------------- | :---------- | :---------------------------------------------------------- |
| `id`             | uuid        | PK (Default: `gen_random_uuid()`)                           |
| `artifact_id`    | uuid        | FK -> artifacts.id (Unique)                                 |
| `attempt_number` | int4        | Def: `1`. Chequeo `(1, 2)`                                  |
| `state`          | text        | Def: `PHASE2_DRAFT`.                                        |
| `qa_decision`    | jsonb       | Estructura: `{ decision, notes, reviewed_by, reviewed_at }` |
| `created_at`     | timestamptz | Def: `now()`                                                |
| `updated_at`     | timestamptz | Def: `now()`                                                |

### 2.2. Tabla `curation_rows`

Corresponde a las fuentes individuales.
_Archivo CSV asociado: `curation_rows_rows.csv`_

| Columna              | Tipo        | Descripción                                |
| :------------------- | :---------- | :----------------------------------------- |
| `id`                 | uuid        | PK                                         |
| `curation_id`        | uuid        | FK -> curation.id                          |
| `lesson_id`          | text        | Identificador o string de la lección       |
| `lesson_title`       | text        | Título legible                             |
| `component`          | text        | Ej: `READING`, `VIDEO`, `QUIZ`             |
| `is_critical`        | bool        | Def: `false`                               |
| `source_ref`         | text        | La URL o Referencia                        |
| `source_title`       | text        | Título de la fuente (scrapeado o generado) |
| `source_rationale`   | text        | Justificación de la IA                     |
| `url_status`         | text        | Def: `PENDING`. (Estado técnico)           |
| `http_status_code`   | int4        | Código HTTP real (200, 404, etc)           |
| `last_checked_at`    | timestamptz | Fecha del último ping                      |
| `failure_reason`     | text        | Mensaje de error si falló                  |
| `apta`               | bool        | Decisión humana: ¿Es útil?                 |
| `motivo_no_apta`     | text        | Razón de rechazo                           |
| `cobertura_completa` | bool        | Decisión humana: ¿Cubre todo el tema?      |
| `notes`              | text        | Notas adicionales del curador              |
| `auto_evaluated`     | bool        | Si pasó por validación automática          |
| `auto_reason`        | text        | Explicación del sistema automático         |
| `forbidden_override` | bool        | Override manual de reglas                  |
| `created_at`         | timestamptz |                                            |
| `updated_at`         | timestamptz |                                            |

### 2.3. Tabla `curation_blockers`

Para componentes que bloquean el avance.

| Columna        | Tipo        | Descripción                      |
| :------------- | :---------- | :------------------------------- |
| `id`           | uuid        | PK                               |
| `curation_id`  | uuid        | FK -> curation.id                |
| `lesson_id`    | text        |                                  |
| `lesson_title` | text        |                                  |
| `component`    | text        |                                  |
| `impact`       | text        | Descripción del bloqueo          |
| `owner`        | text        | Persona asignada                 |
| `status`       | text        | `OPEN`, `MITIGATING`, `ACCEPTED` |
| `created_at`   | timestamptz |                                  |

---

## 3. Arquitectura de Dominio (`src/domains/curation`)

```text
apps/web/src/domains/curation/
├── components/
│   ├── SourcesCurationGenerationContainer.tsx  # Orquestador
│   ├── CurationDashboard.tsx                   # Vista principal
│   ├── CurationRowItem.tsx                     # Fila de edición (coincide con curation_rows)
│   ├── CurationBlockerList.tsx                 # Gestión de blockers
├── hooks/
│   └── useCuration.ts
├── types/
│   └── curation.types.ts                       # Tipos EXACTOS de la DB
└── services/
    └── curation.service.ts                     # Cliente Supabase
```

---

## 4. Lógica de Negocio y Backend (Automated Pipeline)

El proceso de curaduría se divide en 3 fases secuenciales gestionadas por background jobs (`curation-background.ts` y `validate-curation-background.ts`).

### 4.1. Fase 1 y 2: Búsqueda y Generación (Search & Generation)

_Implementado en `curation-background.ts`_

1.  **Objetivo**: Encontrar al menos una fuente candidata para cada componente del plan instruccional.
2.  **Estrategia de Búsqueda**:
    - Se utiliza `googleSearch` tool nativa de Gemini.
    - Se verifica **estrictamente** que cada URL provenga de `groundingChunks` (anti-alucinación).
    - **Resolución de Redirects**: Se resuelven las URLs de `vertexaisearch` y `grounding-api-redirect` para obtener el enlace final real.
3.  **Fase 2 (Recuperación):**
    - Si la Fase 1 falla para ciertos componentes, se ejecuta una ronda de recuperación.
    - Se ajusta la temperatura (`-0.4`) para forzar resultados más deterministas.
    - Se intenta reasignar URLs de "grounding" excedentes a componentes huérfanos si son relevantes.

### 4.2. Fase 3: Validación y Calificación Avanzada (Deep Validation)

_Implementado en `validate-curation-background.ts`_

Esta es la fase crítica de control de calidad. Cada fuente encontrada se somete a un juicio estricto tanto técnico como semántico.

#### A. Validación Técnica (Pre-LLM)

Antes de gastar tokens en IA, se ejecutan chequeos de bajo nivel:

1.  **Resolución de Redirects**: Se asegura llegar a la URL final (status 200).
2.  **Detección de Bloqueos**: Se rechazan dominios no educativos (Youtube, Facebook, Reddit, Medium Profiles).
3.  **Detección de "Soft 404"**:
    - Se analizan patrones en el `<title>` (ej: "Page not found", "Error 404").
    - Se analizan patrones en el HTML body (ej: H1 con "No encontrado").
4.  **Verificación de Homepages**:
    - Regex para detectar si es una landing page genérica (`/`, `/home`, `/index.html`).
    - Análisis de contenido genérico (e.g., "Welcome to our site", "Contact us").
5.  **Contenido Mínimo**:
    - Se rechaza si tiene < 150 palabras.
    - Se alerta si tiene < 300 palabras (posible contenido pobre).

#### B. Validación Semántica (Scoring System)

Si pasa la validación técnica, se envía el contenido (hasta 8000 chars) a un modelo de razonamiento (`gemini-2.5-pro` o configurado) con un prompt **ULTRA-ESTRICTO**.

**Sistema de Calificación (Escala 1-10):**

1.  **Relevance**: ¿Qué tan relacionado está con el tema específico de la lección?
2.  **Depth**: ¿Profundidad del contenido (no superficial)?
3.  **Quality**: Estructura, claridad y autoridad pedagógica.
4.  **Applicability**: Utilidad práctica para el estudiante.

**Compuertas Booleanas (Gates) - RECHAZO INMEDIATO:**

- `is_homepage_or_index`: ¿Es un índice o landing page? -> **RECHAZAR**
- `is_specific_to_topic`: ¿El tema central es el requerido? -> **RECHAZAR SI NO**
- `is_educational`: ¿Es marketing disfrazado? -> **RECHAZAR SI NO**
- `has_depth`: ¿Tiene al menos 3 párrafos sustanciales? -> **RECHAZAR SI NO**

#### C. Criterio de Aprobación

Para que una URL sea marcada como `apta: true`:

- Promedio de Score ≥ **7.0**
- Ningún sub-score ≤ **4.0**
- TODAS las compuertas booleanas (Gates) deben ser positivas (Educational, Specific, Deep).

#### D. Flujo de Recuperación (Retry Loop)

El sistema no se rinde al primer rechazo. Si una URL es rechazada en Fase 3:

1.  **Trigger**: El validador detecta `apta: false` o fallo técnico.
2.  **Búsqueda Alternativa**: Inmediatamente invoca a `searchAlternativeUrl` (usando `SEARCH_MODEL`).
3.  **Re-evaluación**: La nueva URL pasa por todo el pipeline de validación nuevamente.
4.  **Límite**: Este ciclo se repite hasta **4 veces** (MAX_ATTEMPTS) por componente.

### 4.3. Estrategia de Modelos (Model Routing)

| Tarea                    | Modelo Principal   | Fallback           | Config                         |
| :----------------------- | :----------------- | :----------------- | :----------------------------- |
| **Búsqueda** (Fase 1/2)  | `gemini-2.0-flash` | `gemini-2.0-flash` | Temp dinámica, Tools activadas |
| **Validación** (Fase 3)  | `gemini-2.5-pro`   | `gemini-2.0-flash` | Temp 0.1 (Determinista)        |
| **Búsqueda Alternativa** | `gemini-2.5-pro`   | -                  | Alta capacidad de razonamiento |

_Nota: Los modelos son configurables desde la tabla `curation_settings`._

---

## 5. Interfaz de Usuario (Visualización "Premium")

Basado en la referencia visual, la UI debe ser clara, jerárquica y rica en metadatos.

### 5.1. Estructura del Dashboard

- **Agrupación:** Por Lección -> Por Componente.
- **Resumen de Estado:** Badges de conteo (✅ Apta: 160, ❌ No Apta: 32).

### 5.2. Tarjeta de Fuente (Source Card)

Cada fila de `curation_rows` se renderiza como una tarjeta que incluye:

- **Estado Visual:** Icono de Check Verde (Apta) o Cruz Roja (No Apta).
- **Tags:**
  - `TIPO_COMPONENTE` (ej: DIALOGUE, QUIZ).
  - `CRITICO` (Badge rojo si `is_critical` es true).
  - `ACCESIBLE` (Badge verde si status 200).
- **Datos:** Título de la fuente y URL (con enlace externo).
- **Descripción:** Justificación corta generada por la IA.
- **Acciones:** Botón desplegable para editar decisión (Apta/No Apta) o nota.

---

## 6. Siguientes Pasos Técnicos

1.  **DB:** Ejecutar script SQL de inicialización.
2.  **Tipos:** Generar `curation.types.ts` exacto a la DB.
3.  **Prompt:** Asegurar que existe la tabla `system_prompts` y tiene el prompt base; si no, crearlo.
4.  **Servicio:** Implementar el cliente `google-generative-ai` con la lógica de fallback Pro/Flash.
