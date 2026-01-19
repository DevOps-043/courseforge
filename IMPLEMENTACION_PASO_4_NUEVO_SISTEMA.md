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

El proceso de curaduría es un **Background Job** complejo que debe manejar fallos y alucinaciones.

### 4.1. Fuentes de Prompts

El sistema utilizará una combinación de prompts almacenados y dinámicos:

1.  **System Prompt (Instrucción Base):**
    - Se obtendrá de la tabla `system_prompts` donde `code = 'CURATION_PLAN'`.
    - _Nota:_ Este prompt define la personalidad y las reglas generales de curaduría.

2.  **User Prompt (Contexto y Búsqueda):**
    - Se construirá dinámicamente incluyendo:
      - Datos del curso (Nombre, Idea Central).
      - Lista de Componentes (Lecciones).
      - **Instrucciones Estrictas de Búsqueda (Google Search):** (Copiadas del sistema anterior)

        ```text
        ⛔⛔⛔ REGLA CRÍTICA: USA SOLO GOOGLE SEARCH ⛔⛔⛔
        Tienes la herramienta Google Search activada y DEBES USARLA para el 100% de las fuentes.
        Cualquier URL que NO provenga de un resultado de Google Search será RECHAZADA automáticamente.

        PARA CADA COMPONENTE:
        1. EJECUTA una búsqueda en Google con palabras clave específicas.
        2. ESPERA y LEE los resultados reales.
        3. EXTRAE URLs ÚNICAMENTE de los resultados (groundingChunks).
        ```

### 4.2. Estrategia de Modelos IA (Fallback)

El sistema implementará una estrategia de doble modelo para garantizar calidad y uso de herramientas:

1.  **Intento 1: Modelo Primario (`gemini-1.5-pro`)**
    - _Configuración:_ `temperature: 0.7`.
    - _Objetivo:_ Máximo razonamiento para seleccionar la mejor fuente pedagógica.

2.  **Intento 2: Modelo Fallback (`gemini-2.0-flash-exp`)**
    - _Trigger:_ Se activa si el modelo primario no retorna `groundingChunks` (no usó la herramienta de búsqueda).
    - _Prompt de Reintento:_ Se inyecta una instrucción de refuerzo:
      ```text
      ⚠️ REINTENTO DE BÚSQUEDA - IMPORTANCIA CRÍTICA ⚠️
      EL INTENTO ANTERIOR FALLÓ PORQUE NO SE ACTIVÓ LA BÚSQUEDA WEB.
      TU TAREA PRINCIPAL ES:
      1. USAR la herramienta de búsqueda de Google.
      2. CITAR las URLs encontradas.
      ```
    - _Ventaja:_ Los modelos Flash suelen tener mayor adherencia a herramientas (Tool Use).

### 4.3. Flujo de Ejecución (`startCurationAction`)

1.  **Validación Inicial:** Verificar que no existan llamadas duplicadas activas para este artefacto.
2.  **Ejecución IA:**
    - Llamada a Gemini con `googleSearch` tool enabled.
    - Verificación de `groundingMetadata`.
3.  **Procesamiento de Resultados:**
    - Parseo del JSON estricto retornado.
    - **Validación de Grounding:** Verificar que cada URL sugerida coincida con una URL real devuelta por Google Search (anti-alicinación).
4.  **Validación HTTP (Ping):**
    - Verificación de que la URL existe (Status 200).
5.  **Persistencia:**
    - Guardar en `curation_rows` con `url_status: 'OK'` o `'BROKEN'`.

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
