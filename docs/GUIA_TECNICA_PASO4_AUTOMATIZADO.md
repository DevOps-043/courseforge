# Guía Técnica: Refactorización Paso 4 - Curaduría Automatizada

Este documento define la arquitectura para el **Paso 4: Curaduría de Contenidos**, fusionando la estructura de datos real con la visión de un sistema **predominantemente automatizado** donde Gemini se encarga de la búsqueda, validación y selección de fuentes.

---

## 1. Filosofía del Sistema (Automatización Primero)

A diferencia del plan original (manual), el flujo será:

1.  **Búsqueda Automática**: El sistema busca candidatos.
2.  **Validación Automática**: Gemini evalúa la calidad (Scoring).
3.  **Auto-Corrección**: Si una fuente no cumple el puntaje, el sistema busca reemplazos automáticamente.
4.  **Revisión Final (QA)**: El usuario solo interviene al final para aprobar o gestionar bloqueos reales.

---

## 2. Máquina de Estados (State Machine)

Para evitar los problemas de "loading infinito", definimos estados explícitos en la base de datos (`curation.state`):

1.  `PHASE2_INIT`: Estado inicial.
2.  `PHASE2_SEARCHING`: Buscando URLs iniciales para todos los componentes.
3.  `PHASE2_EVALUATING`: Descargando contenido y aplicando Scoring con Gemini.
4.  `PHASE2_REFINING`: Buscando reemplazos para las fuentes que fallaron la evaluación (Iterativo).
5.  `PHASE2_READY_FOR_REVIEW`: Proceso automático terminado. Usuario revisa resultados.
6.  `PHASE2_APPROVED`: Aprobado para siguiente paso.

---

## 3. Base de Datos (Schema)

Se mantiene la estructura detallada necesaria para la automatización:

### Tabla: `curation`

Controla el ciclo de vida.

```sql
state: 'PHASE2_SEARCHING' | 'PHASE2_EVALUATING' | 'PHASE2_REFINING' | ...
attempt_number: integer -- Controla ciclos de refinamiento
```

### Tabla: `curation_rows` (Extendido)

```sql
id: uuid
curation_id: uuid
lesson_id: text
component: text
source_ref: text (URL)
-- Control Técnico
url_status: 'OK' | 'ERROR' | 'AUTH_REQUIRED' | 'PENDING'
http_status_code: int
-- Evaluación IA
apta: boolean
cobertura_completa: boolean
evaluation_score: float -- Promedio (ej: 7.5)
evaluation_details: jsonb -- { "relevancia": 8, "profundidad": 7, ... }
notes: text -- Justificación generada por Gemini
-- Meta
auto_evaluated: boolean DEFAULT true
created_at: timestamp
updated_at: timestamp
```

---

## 4. Lógica de Negocio Detallada

### A. Pipeline de Búsqueda (Discovery)

**Trigger**: Usuario inicia curaduría.
**Lógica**:

1.  Leer `instructional_plans`.
2.  Para cada componente, generar queries de búsqueda con Gemini.
3.  Ejecutar Google Search / Vertex AI.
4.  Insertar URLs en `curation_rows` con status `PENDING`.

### B. Pipeline de Evaluación (Scoring)

**Trigger**: Automático al finalizar Búsqueda.
**Lógica**:

1.  **Fetching**: Intentar descargar HTML/PDF de las URLs `PENDING`.
    - Si falla (404/Timeout): Marcar `url_status='ERROR'`.
2.  **Análisis Gemini (Solo URLs 'OK')**:
    - Enviar contenido + Objetivo de Lección a Gemini.
    - **Prompt de Evaluación**:
      ```json
      {
        "relevancia": 1-10, // ¿Coincide con el tema?
        "profundidad": 1-10, // ¿Es técnico o superficial?
        "calidad": 1-10, // ¿Autoridad del dominio?
        "aplicabilidad": 1-10, // ¿Sirve para el componente (ej. Quiz)?
        "justificacion": "string",
        "promedio": float
      }
      ```
    - **Reglas de Decisión (Automáticas)**:
      _ `apta = promedio >= 6.5 AND relevancia >= 4`
      _ `cobertura_completa = promedio >= 7.0` (Ajustado según feedback)

### C. Pipeline de Refinamiento (Auto-Correction)

**Trigger**: Automático si hay fuentes `apta=false` o `url_status='ERROR'`.
**Lógica**:

1.  Identificar componentes "Gaps" (sin fuente válida).
2.  Generar **nuevos queries** más específicos ("Búsqueda de Reemplazo").
3.  Buscar nuevas URLs excluyendo las fallidas.
4.  Evaluar inmediatamente.
5.  Si la nueva fuente es mejor, reemplazar en `curation_rows`.
6.  Repetir hasta `MAX_ATTEMPTS` o cubrir todos los gaps.

---

## 5. Especificaciones de la Interfaz (UI)

La UI debe reflejar que el sistema trabaja por el usuario.

### Componente: `CurationStatusDashboard`

- Barra de progreso real: "Buscando... 10/10", "Evaluando... 5/10".
- Logs en vivo: "Reemplazando fuente rota para Lección 1.2...".

### Componente: `SourcesTable` (Modo Revisión)

- **Read-Only por defecto**: El usuario ve lo que Gemini eligió.
- **Semáforos**:
  - 🟢 **Verde**: Apta + Cobertura Completa (Score >= 7.0).
  - 🟡 **Amarillo**: Apta pero parcial (Score 6.5 - 6.9).
  - 🔴 **Rojo**: No Apta (El sistema falló en encontrar reemplazo).
- **Acciones**:
  - "Ver Análisis": Muestra el desglose de puntajes de Gemini.
  - "Forzar Reemplazo Manual": Botón para que el usuario pegue una URL si el sistema falló.

---

## 6. Integración Técnica

### API Routes Recomendadas

1.  `POST /api/curation/start`: Inicia el proceso background `PHASE2_SEARCHING`.
2.  `GET /api/curation/status`: Polling ligero para la barra de progreso.
3.  `POST /api/curation/override`: Endpoint para edición manual de emergencia.

### Background Workers

- Separar `SearchWorker` de `ValidationWorker` para evitar timeouts.
- Usar una cola simple (o tabla `pipeline_events`) para orquestar los pasos.

---

## 7. JSON Schemas para Prompts

### Prompt de Búsqueda

```json
{
  "queries": [
    "guía completa modelo grow coaching liderazgo",
    "ejemplos prácticos modelo grow pdf"
  ],
  "target_domain_hints": ["hbr.org", "mckinsey.com", "forbes.com"]
}
```

### Prompt de Evaluación

```json
{
  "scores": {
    "relevance": 8,
    "depth": 7,
    "quality": 8,
    "applicability": 9
  },
  "average_score": 8.0,
  "is_appropriate": true,
  "reasoning": "La fuente cubre exhaustivamente el modelo GROW con ejemplos..."
}
```
