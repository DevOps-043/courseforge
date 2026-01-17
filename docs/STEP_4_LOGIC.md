# Documentación Técnica: Paso 4 - Curaduría de Contenidos

Este documento detalla la lógica completa, estructura de base de datos y flujos del Paso 4 (Curaduría) para facilitar su refactorización o reescritura.

## 1. Objetivo del Paso 4

Identificar, validar y seleccionar fuentes de información (URLs, PDFs, Videos, Blogs) de alta calidad para cada componente definido en el Plan Instruccional (Paso 2), asegurando que el contenido sea accesible y relevante para la generación posterior de materiales.

## 2. Base de Datos (PostgreSQL / Supabase)

### Tabla Principal: `curation`

Controla el estado general del proceso de curaduría para un artefacto.

```sql
CREATE TABLE public.curation (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  artifact_id uuid UNIQUE NOT NULL, -- Relación 1:1 con el curso
  attempt_number integer DEFAULT 1, -- Control de intentos (Max 2)
  state text DEFAULT 'PHASE2_DRAFT', -- Estados: PHASE2_DRAFT, PHASE2_GENERATING, PHASE2_GENERATED, PHASE2_READY_FOR_QA, PHASE2_APPROVED
  qa_decision jsonb,
  created_at timestamp,
  updated_at timestamp
);
```

### Tabla de Filas: `curation_rows`

Almacena cada fuente candidata para un componente específico.

```sql
CREATE TABLE public.curation_rows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  curation_id uuid NOT NULL,
  lesson_id text NOT NULL, -- ID de la lección (ej: "L1.1")
  lesson_title text NOT NULL,
  component text NOT NULL, -- Tipo de componente (ej: "READING", "QUIZ")
  is_critical boolean DEFAULT false, -- Si es crítico para el MVP
  source_ref text NOT NULL, -- URL de la fuente
  source_title text,
  url_status text DEFAULT 'PENDING', -- OK, ERROR, AUTH_REQUIRED, MANUAL
  apta boolean, -- Resultado de la evaluación de IA
  cobertura_completa boolean, -- Si cubre todo lo necesario (>= 7.0)
  notes text, -- Detalles de evaluación (ej: "[R=9/P=8...]")
  auto_evaluated boolean DEFAULT false,
  motivo_no_apta text,
  failure_reason text, -- Razón técnica de fallo
  forbidden_override boolean DEFAULT false -- Override manual de 403
);
```

## 3. Arquitectura y Flujo de Datos

### A. Generación Inicial de Fuentes (Trigger: "Iniciar Curaduría")

1.  **Frontend (`CurationForm.tsx` -> `useCuration.ts`)**: Llama a la API para cambiar estado a `PHASE2_GENERATING` e invoca la función de fondo.
2.  **Backend (`curation-background.ts`)**:
    - Lee el `instructional_plans` para obtener la lista de componentes requeridos.
    - Itera por cada componente (en paralelo o lotes).
    - **LLM (Gemini)**: Genera queries de búsqueda para encontrar fuentes candidatas.
    - **Google Search**: Ejecuta búsquedas para encontrar URLs.
    - **Inserción en DB**: Crea registros en `curation_rows` con las URLs encontradas (status `PENDING`).
    - Actualiza estado a `PHASE2_GENERATED`.

### B. Validación de Contenido y Reemplazo (Trigger: "Validar")

1.  **Frontend**: Llama a `validateContentQuality()` y comienza un **polling** para ver progreso.
2.  **Backend (`content-validation-background.ts`)**:
    - **Locking**: Adquiera un lock (Redis o tabla `pipeline_events`) para evitar colisiones.
    - **Iteración**: Busca filas sin evaluar (`apta IS NULL`) o marcadas para re-evaluar.
    - **Fetch URL**: Intenta descargar el contenido HTML/PDF de la URL.
      - Si falla (404, TCP Error): Marca `url_status=ERROR`.
      - Si es accesible: Marca `url_status=OK`.
    - **Evaluación LLM (Gemini)**:
      - Analiza el contenido extraído contra el objetivo de la lección.
      - Devuelve JSON: `{ relevancia, profundidad, calidad, aplicabilidad, promedio }`.
      - **Reglas de Negocio (Actualizadas)**:
        - Promedio >= 6.5 Y Relevancia >= 4 -> `apta=true`.
        - Promedio >= 7.0 -> `cobertura_completa=true`.
    - **Lógica de Reemplazo Automático**:
      - Si una fuente es `NO APTA` o `URL ERROR`, el sistema entra en modo "Búsqueda de Reemplazo".
      - Genera nuevos queries de búsqueda específicos.
      - Usa Google Search / Vertex AI para hallar alternativas.
      - Evalúa inmediatamente la alternativa. Si es mejor, reemplaza la URL en la BD y marca como `auto_evaluated`.
    - **Finalización**: Libera el lock.

### C. Gating y Aprobación

1.  **Frontend**: Polling detecta fin del proceso. Llama a `runValidations` (servicio).
2.  **Validadores (`curation.validators.ts`)**:
    - Analiza si existen "Gaps" (componentes sin fuentes válidas).
    - _Nota_: Recientemente se deshabilitó el bloqueo estricto por petición de usuario, permitiendo avanzar con warnings.

## 4. APIs Utilizadas

- **Supabase Client**: Lectura/Escritura de tablas `curation`, `curation_rows`, `artifacts`.
- **Google Generative AI (Gemini)**:
  - `gemini-2.5-pro`: Evaluaciones de calidad (texto largo).
  - `gemini-2.0-flash`: Búsquedas rápidas y replacements.
- **Netlify Functions**: Ejecución de procesos de larga duración (background jobs).

## 5. Puntos de Dolor Actuales (Why "It's bad")

1.  **Polling vs WebSocket**: El frontend depende de un polling complejo (`setInterval`) para saber si el backend terminó, lo que causa desincronización visual (ej: "Se queda pegado en validando").
2.  **Manejo de Locks**: El sistema usa locks de 90 minutos en DB (`pipeline_events`) que a veces no se limpian si el proceso crashea, bloqueando reintentos.
3.  **Lógica Difusa en Backend**: `content-validation-background.ts` mezcla lógica de fetching, parsing, evaluación y búsqueda de reemplazos en un ciclo `while` gigante, difícil de mantener.
4.  **UX de Errores**: Cuando falla la validación, la UI a veces no muestra claramente _por qué_ (corregido parcialmente recientemente agregando logs detallados).
5.  **Reemplazos Infinitos**: A veces entra en loops buscando reemplazos si no hay buenas fuentes disponibles, consumiendo quota y tiempo.

## 6. Recomendación para Reescritura

- Separar claramente **Fetch** de **Evaluación**.
- Implementar una cola de tareas real (o tabla de jobs) en lugar de funciones monolíticas.
- Usar WebSockets (Ably/Pusher o Supabase Realtime) para progreso en vivo.
- Simplificar el criterio de "Apta" para evitar falsos negativos en fuentes decentes.
