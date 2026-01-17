# Documentación Técnica: Paso 2 (Generación de Temario)

Este documento describe la estructura actual, el funcionamiento y el flujo de datos del **Paso 2 (Syllabus)** tal como está implementado actualmente. Esta guía sirve como referencia para la implementación en nuevos proyectos.

## 1. Visión General

El **Paso 2** tiene como objetivo transformar el "Artefacto" aprobado del Paso 1 (que contiene Idea Central, Objetivos y Descripción) en un **Temario Estructurado** (Syllabus) compuesto por Módulos y Lecciones.

El sistema utiliza un flujo de estados riguroso (DRAFT -> GENERATING -> VALIDATING -> QA) para asegurar la calidad antes de proceder a la generación de contenido.

---

## 2. Arquitectura del Dominio (`src/domains/syllabus`)

La lógica está encapsulada en el dominio `syllabus`, siguiendo una arquitectura modular:

### Estructura de Carpetas

```
src/domains/syllabus/
├── components/          # Componentes de UI (Vistas, Formularios, QA)
├── hooks/               # Hooks de React (useSyllabus, etc.)
├── services/            # Lógica de negocio y comunicación con Supabase
├── types/               # Definiciones de tipos TypeScript (Interfaces)
├── validators/          # Lógica de validación automática (V01-V05)
└── index.ts             # Punto de entrada (Barrel file)
```

---

## 3. Modelo de Datos (Types)

El núcleo del Paso 2 es la interfaz `TemarioEsp02`.

### Entidades Principales

**1. Temario (`TemarioEsp02`)**

- **route**: `A_WITH_SOURCE` (Con fuente) o `B_NO_SOURCE` (Generación pura con IA).
- **modules**: Array de `SyllabusModule`.
- **validation**: Objeto con resultados de validaciones automáticas.
- **qa**: Estado de revisión humana (`PENDING`, `APPROVED`, `REJECTED`).

**2. Módulo (`SyllabusModule`)**

- `id`: UUID único.
- `title`: Título del módulo.
- `objective_general_ref`: Referencia al objetivo general del Paso 1 que cubre este módulo.
- `lessons`: Array de `SyllabusLesson`.

**3. Lección (`SyllabusLesson`)**

- `id`: UUID único.
- `title`: Título de la lección.
- `objective_specific`: Objetivo de aprendizaje específico de la lección.

### Estados del Flujo (`Esp02StepState`)

| Estado | Descripción |
| field | description |
|---|---|
| `STEP_DRAFT` | Estado inicial antes de generar. |
| `STEP_GENERATING` | Solicitud enviada a la IA / Backend. |
| `STEP_VALIDATING` | La IA respondió, se están ejecutando reglas de negocio. |
| `STEP_READY_FOR_QA` | Validaciones pasadas, esperando revisión humana. |
| `STEP_APPROVED` | Aprobado por QA. Fin del paso. |
| `STEP_REJECTED` | Rechazado por QA. Debe regenerarse o editarse. |
| `STEP_ESCALATED` | Error técnico o validación fallida repetidamente. |

---

## 4. Funcionamiento del Pipeline

El servicio `syllabus.service.ts` orquesta todo el proceso.

### Flujo de Generación (`startGeneration`)

1.  **Validación Previa**: Verifica que el Artefacto (Paso 1) esté `APPROVED` y tenga objetivos definidos.
2.  **Inicialización**:
    - Crea un registro en la tabla `syllabus` con estado `STEP_GENERATING`.
    - Registra un evento en `pipeline_events`.
3.  **Ejecución (Background)**:
    - Llama al endpoint `/api/syllabus`.
    - **Producción**: La API responde "processing" y ejecuta la generación en segundo plano (Supabase Edge Functions o similar).
    - **Desarrollo/Local**: Puede esperar la respuesta directa de la IA.

### Procesamiento de Respuesta (`runPipeline`)

Una vez que la IA entrega el contenido (Markdown), el sistema:

1.  **Parsing Inteligente**: Convierte el Markdown en objetos JSON (`modules`).
    - Soporta formatos numerados ("1. Intro") y no numerados.
    - Detecta objetivos específicos automáticamente desde el texto.
2.  **Validación Automática (`runAllValidations`)**:
    - **V01**: Coherencia entre Módulos y Objetivos Generales.
    - **V02**: Cantidad de lecciones por módulo (rango aceptable).
    - **V03**: Existencia y longitud de objetivos específicos.
    - **V04**: Detección de duplicados.
    - **V05**: Integridad de la estructura.
3.  **Decisión de Estado**:
    - Si pasa todas las validaciones -> `STEP_READY_FOR_QA`.
    - Si falla -> `STEP_ESCALATED` (o permite reintentos automáticos).

---

## 5. Características Clave y Mejoras Respecto al Plan Original

### 1. Sistema de Parsing Robusto

Se implementó un parser (`parseMarkdownToModules`) capaz de interpretar variaciones en la salida de la IA. Utiliza expresiones regulares para identificar:

- Títulos de módulos (e.g., "Módulo 1: ...", "🟦 Módulo...").
- Lecciones numeradas y no numeradas.
- Verbos clave ("Explica", "Usa", "Define") para inferir objetivos si no están explícitos.

### 2. Soporte de Importación

Se añadieron métodos para:

- `importTemario`: Cargar un temario desde un Markdown pegado manualmente.
- `createFromParsedModules`: Crear un temario estructurado directamente (útil para migrar datos existentes).

### 3. Manejo de Errores y Seguridad

- Uso de **Transacciones Implicitas**: Las actualizaciones de estado y registros de eventos ocurren de manera sincronizada.
- **Validación de Integridad**: Si el Paso 1 cambia (se desaprueba), el Paso 2 se bloquea.

---

## 6. Referencia de Implementación para Nuevo Proyecto

Para replicar este módulo en un nuevo proyecto, asegúrate de portar:

1.  **Tablas en Base de Datos**:
    - `syllabus`: Almacena el JSON del temario y el estado.
    - `pipeline_events`: Para trazabilidad (logs).
2.  **Types**: Copiar `syllabus.types.ts` completo.
3.  **Validadores**: Copiar `syllabus.validators.ts`. Son reglas de negocio pura, fáciles de reutilizar.
4.  **Servicio**: El `syllabus.service.ts` es el "cerebro". Adaptar las llamadas a `artifactsService` si el modelo de datos de origen cambia.

### Ejemplo de Uso (Service)

```typescript
// Iniciar generación
const result = await syllabusService.startGeneration({
  artifactId: "123-uuid",
  route: "B_NO_SOURCE",
});

// Sondear estado (Polling)
const currentState = await syllabusService.getState("123-uuid");
if (currentState === "STEP_READY_FOR_QA") {
  // Mostrar interfaz de revisión
}
```
