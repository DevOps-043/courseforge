# Análisis Detallado: Paso 4 (Curaduría) - Actual vs. Planeado

Este documento presenta un análisis exhaustivo de la implementación actual del **Paso 4: Curaduría de Fuentes (Fase 2)** en comparación con la documentación técnica original (`Documentacion Go ESP 04.md` y `PLAN_IMPLEMENTACION_ESP04.md`).

---

## 1. Resumen Ejecutivo

La implementación actual **supera** las expectativas del plan original en términos de robustez y validación automática. Mientras que el plan definía la estructura conceptual y el flujo de datos, la implementación ha añadido capas críticas de **validación de URLs en tiempo real**, **procesamiento en segundo plano** (background functions) y **estrategias de reintento inteligente** que hacen el sistema mucho más resiliente.

| Característica      | Plan Original                         | Implementación Actual                                                                          | Estado    |
| :------------------ | :------------------------------------ | :--------------------------------------------------------------------------------------------- | :-------- |
| **Arquitectura**    | Dominios (`src/domains/curation`)     | Idéntica al plan                                                                               | ✅ Cumple |
| **Modelo de Datos** | Tablas normalizadas (`curation_rows`) | Idéntica al plan                                                                               | ✅ Cumple |
| **Generación IA**   | Prompt JSON + Gemini                  | Gemini + **Google Search (Grounding)** + Validación de URLs en vivo                            | 🚀 Supera |
| **Flujo Async**     | No especificado en detalle            | Uso de **Netlify Background Functions** para evitar timeouts                                   | 🚀 Supera |
| **Validación HITL** | Operador marca Apta/Cobertura         | Igual + **Fuentes Manuales** + Revalidación bajo demanda                                       | ✅ Cumple |
| **Estrategia Gaps** | Intento 2 dirigido                    | Intento 2 dirigido + **Estrategias diferencies por ronda** (Wikipedia -> Académico -> General) | 🚀 Supera |

---

## 2. Análisis del Backend (`/api/curation`)

### 2.1 Lógica de Ruta (`route.ts`)

La ruta de API implementada es significativamente más avanzada que un simple wrapper de LLM.

- **Validación de URLs "Hard Core":**
  - La implementación no solo "alucina" URLs, sino que las valida haciendo peticiones HTTP reales.
  - Filtra dominios prohibidos (YouTube, redes sociales) y URLs truncadas (con "...").
  - Detecta códigos de estado 404, 403, etc.
- **Estrategia de Reintentos (Retries):**
  - Implementa `MAX_RETRIES = 3`.
  - Usa `getRetryStrategy(round)` para cambiar el foco de búsqueda si falla el primero (ej: Ronda 1 prioriza Wikipedia/TED, Ronda 2 prioriza Coursera/EdX, Ronda 3 abre el espectro).
- **Google Search Integration:**
  - Usa la herramienta `googleSearch` de Gemini para "grounding", asegurando que la IA busque información actual en la web en lugar de inventar.
- **Manejo de Gaps:**
  - La función `generateDirectedSources` maneja específicamente el "Intento 2", recibiendo una lista de _gaps_ (fichas faltantes) y solicitando reemplazos específicos.

### 2.2 Prompt (`curation.prompts.md`)

El prompt externalizado en Markdown cumple estrictamente con el plan:

- **Formato:** JSON estricto (`sources_by_lesson`).
- **Reglas de Negocio:**
  - "CERO DESCARGABLES OBLIGATORIOS".
  - Prohibición de URLs truncadas.
  - Priorización de fuentes accesibles.
- **Bitácora:** Solicita estructura de bitácora dentro del JSON, permitiendo trazabilidad directa desde la generación.

---

## 3. Análisis del Frontend (`src/domains/curation`)

### 3.1 Servicio (`curation.service.ts`)

El servicio actúa como un orquestador complejo que maneja la asincronía.

- **Background Jobs:** En lugar de mantener la conexión HTTP abierta (que fallaría a los 10-26s en Vercel/Netlify), el servicio dispara una **Background Function** (`/.netlify/functions/curation-background`) y retorna inmediatamente.
- **Polling Inteligente:** La UI hace polling para verificar el estado de la generación.
- **Funcionalidades Extra:**
  - `addManualSource`: Permite al usuario "salvar" un componente agregando una URL a mano sin pasar por la IA.
  - `revalidatePendingUrls`: Permite re-verificar URLs que quizás fallaron por timeout momentáneo.
  - `fillMissingCoverage`: Lógica específica para detectar qué falta y lanzar solo esas búsquedas.

### 3.2 Validadores (`curation.validators.ts`)

Implementa la lógica determinista requerida por el plan "DoD" (Definition of Done).

- `validateUrlOperability`: Verifica HTTP 200.
- `validateCoveragePerComponent`: Asegura que haya al menos 1 fuente válida por componente.
- `validateCriticalCoverage`: Reglas más estrictas para componentes marcados como críticos.
- **Diferencia Notable:** Se ha relajado la severidad de algunos chequeos de `error` a `warning` (ej. `validateUrlOperability`), permitiendo al usuario avanzar bajo su propio riesgo si así lo decide (HITL sovereigns), aunque el sistema advierte.

### 3.3 Interfaz de Usuario (`CurationForm.tsx`)

- **Visualización de Estado:** Usa un sistema de Badges y colores consistente con el resto de la app.
- **Feedback en Tiempo Real:** Muestra barras de progreso detalladas durante la validación y generación (ej. "Validando URL 3/10...").
- **Gestión de Errores:** Maneja timeouts de polling y permite reintentos manuales.

---

## 4. Comparativa de Archivos y Componentes

| Archivo / Componente  | Planificado (`PLAN_...md`)     | Implementación Actual                          | Comentarios                                    |
| :-------------------- | :----------------------------- | :--------------------------------------------- | :--------------------------------------------- |
| `curation.types.ts`   | Tipos bases (`CurationRow`...) | Tipos bases + `UrlStatus` + `DetectedGap`      | Tipado más rico para manejar errores de red.   |
| `curation.service.ts` | Métodos CRUD básicos           | CRUD + Background Func + Validación URL        | Mucho más lógica de negocio en el cliente.     |
| `/api/curation/route` | Prompt Wrapper                 | Prompt + Search Tool + HTTP Check + Strategies | El backend es mucho más "inteligente".         |
| `SourceRow.tsx`       | Fila editable                  | Fila editable + Status Indicator (🚦)          | Feedback visual del estado de la URL.          |
| `ArtifactViewer.tsx`  | Tab Paso 4                     | Integrado                                      | Correctamente integrado en el flujo principal. |

---

## 5. Conclusión

La implementación del Paso 4 es **altamente madura y robusta**. No solo cumple con los requisitos funcionales del documento de diseño, sino que anticipa problemas comunes en sistemas de agentes autónomos (alucinaciones de URLs, timeouts de red, fuentes caídas) y los mitiga activamente mediante validación en tiempo real y estrategias de fallback.

### Puntos Fuertes:

1.  **Fiabilidad:** No confía ciegamente en la IA; verifica cada URL.
2.  **Escalabilidad:** Usa background functions para tareas largas.
3.  **Flexibilidad:** Permite intervención humana manual cuando la IA falla.

### Recomendaciones (Minor):

1.  Asegurar que la configuración de `curation-background` esté correctamente desplegada en el entorno de producción (Netlify functions), ya que es una dependencia crítica invisible en el código estático.
2.  Verificar que los límites de cuota de la API de Google Search/Gemini soporten la carga de validaciones concurrentes si el volumen de usuarios aumenta.
