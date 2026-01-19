# Plan de Implementación: Validación de Contenido y Curaduría (Fase 4)

Este documento detalla el flujo técnico y lógico para la implementación del sistema de validación y curaduría de enlaces en el Paso 4.

## 1. Disparador y Configuración Inicial

**Acción de Usuario:** El usuario presiona el botón "Validar Contenido" en la interfaz.
**Acción del Sistema:** Se invoca una función en background (`validate-curation-background.ts`).

### Selección de Modelos

El sistema debe consultar la tabla `curation_settings` (o config default) para determinar qué modelos usar.

- **Modelos de Evaluación (Review):**
  - _Principal:_ `3-pro-review`
  - _Fallback:_ `3-flash-review` (se usa si el principal falla o no responde).
- **Modelos de Búsqueda (Search):**
  - _Principal:_ (e.g., Google Search API / Custom Search)
  - _Fallback:_ (e.g., Bing Search o Tavily)

---

## 2. Flujo de Validación por Enlace (URL)

El sistema itera sobre cada componente (fila de curaduría) existente. Si un componente tiene una URL asignada, se procede a evaluarla.

### Criterios de Evaluación

Se utiliza el modelo de evaluación seleccionado para calificar la URL en 4 dimensiones (escala 1-10):

1.  **Relevancia:** ¿Qué tan relacionado está el contenido con el componente instruccional?
2.  **Profundidad:** ¿El contenido tiene suficiente detalle y rigor?
3.  **Calidad:** ¿Es una fuente confiable, bien redactada y estructurada?
4.  **Aplicabilidad:** ¿Es útil para el objetivo de aprendizaje específico?

**Cálculo:** `Promedio = (Relevancia + Profundidad + Calidad + Aplicabilidad) / 4`

### Decisión de Aprobación

- **Umbral de Aprobación:** `Promedio > 6.5`

#### Caso A: Aprobado (> 6.5)

1.  **Estado:** Se marca `apta = true`.
2.  **Cobertura:** Se marca `cobertura_completa = true`.
3.  **Feedback:** Se genera y guarda una nota en el campo `notes` con:
    - La calificación obtenida (promedio).
    - Un feedback breve y accionable generado por el modelo.

#### Caso B: Rechazado (≤ 6.5) o Error Técnico (404/Inaccesible)

1.  **Estado:** Se marca inicialmente como inválido.
2.  **Acción:** Se activa el **Proceso de Recuperación** (ver sección 3).

---

## 3. Proceso de Recuperación (Búsqueda + Reevaluación)

Si un enlace es rechazado o no funciona, el sistema intenta encontrar uno mejor automáticamente.

1.  **Búsqueda:** El modelo de búsqueda activo busca URLs alternativos basándose en el título y descripción del componente.
2.  **Evaluación de Candidato:** El nuevo URL encontrado es evaluado inmediatamente por el modelo de evaluación (mismos criterios).
3.  **Decisión:**
    - **Si `> 6.5`:** Se aprueba, se reemplaza la URL en la base de datos, se guarda la nota y se avanza.
    - **Si `≤ 6.5`:** Se descarta y se intenta de nuevo.
4.  **Límite de Intentos:** Se realizan hasta **3 intentos** de búsqueda y evaluación.
5.  **Resultado Final:**
    - Si se encuentra un buen URL: Éxito (Reemplazo).
    - Si tras 3 intentos no hay éxito: El componente se marca en una **Lista de Pendientes** (estado interno o flag 'needs_review') y el sistema continúa con el siguiente componente.

---

## 4. Segundo Pase (Retry de Pendientes)

Al terminar la validación de todos los componentes "fáciles" o directos:

1.  El sistema identifica los componentes que quedaron en la **Lista de Pendientes**.
2.  Se ejecuta una **segunda iteración** específica para estos ítems.
3.  Se repite el ciclo: `Búsqueda -> Validación -> (hasta 3 intentos)`.
4.  Si aún así no se resuelve, el componente queda marcado finalmente como `apta = false` o con una nota de "Atención Requerida" para intervención manual del usuario.

---

## 5. Escaneo de Integridad y Completitud (Sanity Check)

El proceso de validación funciona también como un auditor de completitud.

**Regla:** Ningún componente puede quedarse sin URL.

1.  **Detección de Vacíos:** Antes o durante el barrido, el sistema detecta componentes que:
    - Tienen `url` vacía o nula.
    - Fueron creados en el plan instruccional pero no tienen fila correspondiente en curación.
2.  **Acción Correctiva:**
    - Para cada componente "huérfano" o vacío, se activan inmediatamente los **Modelos de Búsqueda**.
    - Se obtienen candidatos.
    - Se validan (criterio > 6.5).
    - Se asigna el mejor candidato aprobado.

---

## Resumen del Algoritmo

```mermaid
graph TD
    A[Inicio: Validar Contenido] --> B{Config Curation Settings}
    B --> C[Iterar Componentes]
    C --> D{¿Tiene URL?}
    D -- No --> E[Activar Búsqueda (Recovery)]
    D -- Si --> F[Evaluar URL (Modelo Principal)]
    F --> G{Promedio > 6.5?}
    G -- Si --> H[Aprobar: apta=true, nota=feedback]
    G -- No --> E
    F -- Error/404 --> E
    E --> I[Buscar Candidato Alternativo]
    I --> J[Evaluar Candidato]
    J --> K{Promedio > 6.5?}
    K -- Si --> L[Reemplazar URL y Aprobar]
    K -- No --> M{Intento < 3?}
    M -- Si --> I
    M -- No --> N[Agregar a Pendientes]
    N --> O[Continuar siguiente componente]
    H --> O
    L --> O
    O --> P{¿Fin de lista?}
    P -- No --> C
    P -- Si --> Q[Segundo Pase de Pendientes]
    Q --> R[Fin del Proceso]
```
