# Análisis de Deuda Técnica — CourseForge

**Fecha**: 2026-03-24
**Alcance**: Análisis exhaustivo de ~120 archivos fuente, 11 Netlify functions, 21 migraciones SQL, configuración y dependencias.
**Objetivo**: Documentar toda la deuda técnica acumulada por vibecoding y generar un plan de refactorización incremental.

---

## Tabla de Contenido

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [God Files — Archivos Gigantes con Responsabilidades Mezcladas](#2-god-files)
3. [Código Duplicado](#3-código-duplicado)
4. [Magic Strings y Magic Numbers](#4-magic-strings-y-magic-numbers)
5. [Type Safety — Uso Excesivo de `any` y Tipos Inconsistentes](#5-type-safety)
6. [Patrones Inconsistentes](#6-patrones-inconsistentes)
7. [Código Muerto y Dependencias No Usadas](#7-código-muerto)
8. [Seguridad](#8-seguridad)
9. [Performance](#9-performance)
10. [Base de Datos](#10-base-de-datos)
11. [Configuración y Tooling](#11-configuración-y-tooling)
12. [Plan de Refactorización](#12-plan-de-refactorización)

---

## 1. Resumen Ejecutivo

| Categoría | Hallazgos | Severidad Máxima |
|---|---|---|
| God Files (>500 líneas) | 5 archivos | CRÍTICA |
| Código Duplicado | 15+ patrones | CRÍTICA |
| Magic Strings/Numbers | 40+ instancias | ALTA |
| Uso de `any` | 30+ solo en actions.ts | CRÍTICA |
| Tipos Duplicados/Inconsistentes | 4 conflictos | ALTA |
| Patrones Inconsistentes | Auth (3 patrones), error handling (3 estilos), logging (0 estructura) | ALTA |
| Código Muerto | Dependencias, comentarios, imports | BAJA |
| Seguridad | Auth en Netlify functions, sin validación UUID | CRÍTICA |
| Performance | Delays bloqueantes, N+1 queries | MEDIA |
| DB Schema | Enums conflictivos, indexes faltantes | ALTA |

**Deuda técnica estimada**: ~10-14 días de refactorización para reducir significativamente.

---

## 2. God Files

### 2.1 `apps/web/src/app/admin/artifacts/actions.ts` — 1578 líneas (CRÍTICA)

**El archivo más problemático del proyecto.** Contiene 30+ funciones exportadas que cubren todo el pipeline:
- CRUD de artefactos
- Generación de syllabus
- Plan instruccional
- Curación de fuentes
- Materiales
- Pipeline events
- Cascade deletes

**Problemas específicos:**
- URL construction duplicada 8 veces (líneas 88, 153, 228, 271, 487, 795, 1072, 1205)
- **Inconsistencia de puertos**: línea 153 usa `localhost:8888`, el resto usa `localhost:3000`
- Fetch pattern para background functions duplicado 8 veces
- 30+ usos de `any` type
- Auth check inconsistente: algunas funciones usan `getAuthenticatedUser()`, otras hacen inline `supabase.auth.getUser()`

### 2.2 `apps/web/src/domains/curation/components/SourcesCurationGenerationContainer.tsx` — 1179 líneas (ALTA)

Componente que maneja generación, validación, dashboard, settings y QA de curación en un solo archivo.

### 2.3 `apps/web/src/domains/plan/components/InstructionalPlanGenerationContainer.tsx` — 935 líneas (ALTA)

Mezcla lógica de generación, validación y renderizado UI.

### 2.4 `apps/web/src/domains/materials/components/ProductionAssetCard.tsx` — 822 líneas (ALTA)

Maneja video upload, URL validation, asset state management y rendering todo junto.

### 2.5 `apps/web/src/components/lia/ChatWindow.tsx` — 683 líneas (CRÍTICA)

**Nesting de 7-8 niveles** en la función `handleSend` (líneas 202-450+):
```
handleSend
  → screenshot capture check
    → LIA service call
      → action detection
        → executeWithContinuation (async recursiva)
          → DOM scanning
            → action execution
              → continuation condition check
                → recursion check
```

**Responsabilidades mezcladas:**
- Chat message management (setState, localStorage)
- Screenshot capture
- DOM scanning
- Action detection (60+ regex patterns hardcoded, líneas 16-82)
- Action execution con continuaciones recursivas
- Message polling
- UI rendering

### 2.6 `apps/web/netlify/functions/unified-curation-logic.ts` — 823 líneas (CRÍTICA)

**Función principal de 547 líneas** con:
- 6 niveles de nesting: `while → for → if → try → for → for`
- Lógica de grounding URL fallback repetida 3 veces (líneas 500-543, 584-626, 650-688) — bloques de ~40 líneas idénticos
- 63 `console.log` statements

---

## 3. Código Duplicado

### 3.1 URL Construction en actions.ts (8 repeticiones)

```typescript
// Este patrón aparece 8 veces con variaciones:
const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || 'http://localhost:3000';
const baseUrl = appUrl.replace(/\/$/, '');
const backgroundFunctionUrl = `${baseUrl}/.netlify/functions/{nombre}`;
```

**Ubicaciones**: líneas 88-90, 153-154, 228-231, 271-273, 487-489, 795-797, 1072-1074, 1205-1207

**Agravante**: línea 153 usa puerto `8888` mientras el resto usa `3000`.

### 3.2 Fetch Pattern para Background Functions (8 repeticiones)

```typescript
// Repetido 8 veces con logging y error handling casi idéntico:
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
if (!response.ok) {
  console.warn(`Background trigger failed: ${response.status}`);
}
```

**Ubicaciones**: líneas 96-106, 167-173, 238-248, 287-296, 508-520, 815-825, 1090-1100, 1214-1224

### 3.3 Boilerplate de Netlify Functions (11 funciones)

**HTTP method check + JSON parsing** duplicado en TODAS las funciones:
```typescript
if (event.httpMethod !== 'POST') {
  return { statusCode: 405, body: 'Method Not Allowed' };
}
let body;
try {
  body = JSON.parse(event.body || '{}');
} catch (e) {
  return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
}
```

**Archivos afectados:**
- `generate-artifact-background.ts` (líneas 28-38)
- `syllabus-generation-background.ts` (líneas 51-61)
- `instructional-plan-background.ts` (líneas 45-55)
- `materials-generation-background.ts` (líneas 47-56)
- `validate-plan-background.ts` (líneas 109-119)
- `validate-materials-background.ts` (líneas 15-25)
- `video-prompts-generation.ts` (líneas 49-59)
- `unified-curation-logic.ts`
- `curation-background.ts`
- `validate-curation-background.ts`
- `auth-sync.ts`

### 3.4 Supabase Client Initialization (11 funciones)

Cada función inicializa su propio cliente con variaciones:
- `generate-artifact-background.ts:49-55` — usa anon key
- `syllabus-generation-background.ts:74-77` — usa service role key primero
- `instructional-plan-background.ts:69-83` — lógica de fallback compleja
- `curation-background.ts:13-22` — usa service role key solo

### 3.5 Grounding URL Fallback (3 repeticiones en unified-curation-logic.ts)

Bloques de ~40 líneas idénticos en líneas 500-543, 584-626, 650-688.

### 3.6 Prompts de Plan Instruccional Duplicados

- `apps/web/src/config/prompts/instructional-plan.ts` (123 líneas)
- `apps/web/src/shared/config/prompts/instructional-plan.prompts.ts` (113 líneas)

Ambos exportan `INSTRUCTIONAL_PLAN_SYSTEM_PROMPT` con contenido 95% idéntico pero pequeñas variaciones.

### 3.7 Utilidad `cn()` Duplicada

- `apps/web/src/lib/utils.ts` (6 líneas)
- `apps/web/src/shared/utils/cn.ts` (6 líneas)

Implementación idéntica en dos ubicaciones.

---

## 4. Magic Strings y Magic Numbers

### 4.1 Timeouts y Delays Hardcoded

| Valor | Ubicación | Propósito |
|---|---|---|
| `3000` ms | `SourcesCurationGenerationContainer.tsx:167`, `ArtifactClientView.tsx:123` | Polling interval, toast delay |
| `4000` ms | `ArtifactClientView.tsx:130` | Toast delay |
| `5000` ms | `useCuration.ts:59,65`, `SyllabusGenerationContainer.tsx:105` | Polling interval |
| `8000` ms | `materials-generation-background.ts:260` | Delay entre operaciones |
| `10000` ms | `unified-curation-logic.ts` | Timeout de validación |
| `300000` ms | `ArtifactsList.tsx:193` | Cooldown de validación (5 min) |
| `Math.random() * 3000` | `materials-generation-background.ts:126` | Delay aleatorio en handler |
| `500 * 1024 * 1024` | `ProductionAssetCard.tsx:60` | Límite de tamaño de video (500MB) |

### 4.2 Model Names Hardcoded (15+ lugares)

```typescript
// Aparecen en múltiples archivos sin constante centralizada:
'gemini-2.0-flash'
'gemini-1.5-pro'
'gemini-2.0-flash-exp'
```

### 4.3 State Strings Hardcoded

```typescript
// Sin enum, repetidos como strings literales en toda la codebase:
'STEP_APPROVED'
'STEP_READY_FOR_QA'
'STEP_READY_FOR_REVIEW'
'PHASE2_READY_FOR_QA'
'PHASE3_READY_FOR_QA'
'PHASE3_NEEDS_FIX'
'NEEDS_FIX'
'GENERATING'
'VALIDATING'
```

### 4.4 Quiz Specs Duplicados

```typescript
// Hardcoded en 2 lugares de materials-generation-background.ts (líneas 225, 415):
{ min_questions: 3, max_questions: 5, types: [...] }
```

### 4.5 Batch Sizes y Configuración

```typescript
// unified-curation-logic.ts (líneas 7-12):
const LESSONS_PER_BATCH = 2;
const SOURCES_PER_LESSON = 2;
const MIN_CONTENT_LENGTH = 500;
const DELAY_BETWEEN_BATCHES_MS = 5000;
// Definidos como constantes locales, no centralizados
```

---

## 5. Type Safety

### 5.1 Uso Excesivo de `any` en actions.ts (CRÍTICA)

**30+ instancias** en `apps/web/src/app/admin/artifacts/actions.ts`:

| Línea | Uso | Debería ser |
|---|---|---|
| 10 | `supabase: any` | `SupabaseClient` |
| 25 | `supabase: any` | `SupabaseClient` |
| 340 | `lessonPlans: any[]` | `LessonPlan[]` |
| 526 | `updates: any` | Interface tipada |
| 116, 180, 257... | `catch (error: any)` | `catch (error: unknown)` |

### 5.2 Tipos de Curación Duplicados (CRÍTICA)

**Dos archivos definen tipos de curación:**
- `apps/web/src/shared/types/curation.types.ts` — Versión incompleta con `[key: string]: any`
- `apps/web/src/domains/curation/types/curation.types.ts` — Versión canónica con tipos propios

**Riesgo**: Developers importan el tipo incorrecto, causando mismatches sutiles.

### 5.3 Naming de Estados Inconsistente (ALTA)

| Dominio | Tipo | Prefijo |
|---|---|---|
| Syllabus | `Esp02StepState` | `STEP_` |
| Plan Instruccional | `Esp03StepState` | `STEP_` |
| Curación | `CurationState` | `PHASE2_` |
| Materiales | `Esp05StepState` | `PHASE3_` |

**No hay un type unificado** que represente el estado del pipeline completo.

### 5.4 Content Type Demasiado Loose

```typescript
// materials.types.ts línea 98:
content: Record<string, unknown>; // JSON dinámico según tipo
```

Debería ser una discriminated union por tipo de componente (`DIALOGUE`, `READING`, `QUIZ`, etc.).

### 5.5 Validators con Severity Incorrecta

```typescript
// materials.validators.ts — Cuando la validación PASA:
return {
    code: 'CTRL3_COMPONENTS_COMPLETE',
    pass: true,
    message: 'Todos los componentes esperados fueron generados',
    severity: 'error',  // BUG: debería ser 'info' o 'success'
};
```

**Líneas afectadas**: 41, 75, 92, 113, 142, 186, 213, 308, 363.

### 5.6 `any` en Netlify Functions

- `unified-curation-logic.ts`: `any` en líneas 300+, 337, 341, 360, 369-370, 391, 412, 468-469
- `materials-generation-background.ts:214`: Campos casteados desde `any`
- `syllabus-generation-background.ts:138-140`: `route` type no narrowed

---

## 6. Patrones Inconsistentes

### 6.1 Autenticación (3 Patrones Diferentes)

**Patrón A** — Helper function (correcto):
```typescript
// Definido en actions.ts líneas 10-20
const user = await getAuthenticatedUser(supabase);
```

**Patrón B** — Inline getUser:
```typescript
// Usado en líneas 122, 222, 265, etc.
const { data: { user } } = await supabase.auth.getUser();
```

**Patrón C** — Inline getSession:
```typescript
// Usado en línea 127
const { data: { session } } = await supabase.auth.getSession();
```

### 6.2 Error Handling (3 Estilos)

| Estilo | Ejemplo | Ubicación |
|---|---|---|
| `{ success: boolean, error?: string }` | Server actions | `artifacts/actions.ts` |
| `throw new Error()` | Servicios | Varios |
| `{ pass, severity, code, message }` | Validators | `materials.validators.ts` |
| `NextResponse.json({ error })` | API routes | `publish/route.ts` |

### 6.3 Supabase Key Strategy (4 Variantes)

| Función | Estrategia |
|---|---|
| `generate-artifact-background.ts` | Anon key + user token en headers |
| `syllabus-generation-background.ts` | Service role key primero, fallback a anon |
| `instructional-plan-background.ts` | Fallback complejo con 3 opciones |
| `curation-background.ts` | Service role key solo |

### 6.4 Logging (Sin Estructura)

- **147+ `console.log`** en Netlify functions
- **51 archivos** con console logging en el frontend
- Sin niveles de log diferenciados
- Algunos prefijos como `[Background Job]`, la mayoría sin prefijo
- Sin correlation IDs
- Sin formato JSON para parseo

### 6.5 Validación (Zod vs Manual)

- `validate-plan-background.ts:176-181` — Usa Zod schemas
- `validate-materials-background.ts:176-230` — Validación manual inline
- `unified-curation-logic.ts` — Parsing y validación runtime de JSON

---

## 7. Código Muerto

### 7.1 Dependencias No Usadas

| Dependencia | package.json | Importada | Estado |
|---|---|---|---|
| `html2canvas` | `apps/web/package.json:37` | Nunca | El proyecto usa `html-to-image` |
| `@google/generative-ai` | `package.json:29` (root) | Parcial | Reemplazada por `@google/genai` |

### 7.2 Código Comentado

| Archivo | Línea | Contenido |
|---|---|---|
| `instructional-plan-background.ts` | 234 | `// await supabase.from('artifacts').update(...)` — Intencional o forgotten? |
| `validate-plan-background.ts` | 1-2 | `// import { Handler } from '@netlify/functions';` — Import sin resolver |
| `validate-curation-background.ts` | 54-56 | `// Optional: Delete previous rows...` — Decisión de diseño no resuelta |

### 7.3 Comentarios Duplicados

```typescript
// ArtifactClientView.tsx líneas 30-31:
// Calculate initial step based on artifact state (persist step across refreshes)
// Calculate initial step based on artifact state (persist step across refreshes)
```

### 7.4 Declaración de Tipo Innecesaria

```typescript
// artifacts/[id]/publish/actions.ts línea 7:
declare const process: any; // process ya está tipado globalmente
```

---

## 8. Seguridad

### 8.1 User Token en Body de Netlify Functions (CRÍTICA)

`generate-artifact-background.ts:40,53-55`: Pasa `userToken` en el body del request. Las Netlify functions pueden ejecutarse por 10-26 segundos. Si el JWT expira durante la ejecución, la operación falla silenciosamente.

**Solución**: Usar `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en background functions + validar origen del request con shared secret.

### 8.2 Sin Validación de Input en Background Functions (ALTA)

- `artifactId`, `materialsId`, `lessonId` — Strings sin validación UUID
- `lessonIds` se verifica como "undefined" string pero no como formato válido
- Sin límite de tamaño de request
- Sin rate limiting

### 8.3 Environment Variables Sin Validación (MEDIA)

```typescript
// Patrón en todas las funciones:
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Non-null assertion sin verificar que la variable existe
```

`auth-sync.ts:50-51` es el único que valida. El resto asume.

### 8.4 JSON Parsing Inseguro (MEDIA)

`unified-curation-logic.ts:549-574`: Parsea JSON potencialmente malformado del modelo AI. Si falla, intenta extraer con substring — podría tener éxito con JSON parcial/malicioso.

---

## 9. Performance

### 9.1 Delays Bloqueantes en Handlers (ALTA)

```typescript
// materials-generation-background.ts:126
await new Promise(r => setTimeout(r, Math.random() * 3000)); // 0-3s random delay

// materials-generation-background.ts:260
await new Promise(r => setTimeout(r, 8000)); // 8 segundos hardcoded

// unified-curation-logic.ts:419
await delay(DELAY_BETWEEN_BATCHES_MS); // 5 segundos
```

### 9.2 N+1 Queries (MEDIA)

```typescript
// validate-materials-background.ts:103-141
for (const lesson of lessons) {
  const { data: components } = await supabase
    .from('material_components')
    .select('*')
    .eq('lesson_id', lesson.id);
  // Query individual por cada lección
}
```

**Solución**: Batch fetch de todos los componentes con `lesson_id IN (...)`.

### 9.3 Sin Paginación en Queries Grandes (BAJA)

```typescript
// materials-generation-background.ts:129-135
const { data: pendingLessons } = await supabase
  .from('material_lessons')
  .select('*')      // Fetch all columns
  .eq('materials_id', materialsId)
  .limit(1);        // Limit DESPUÉS de seleccionar todo
```

---

## 10. Base de Datos

### 10.1 Enums de Estado Conflictivos (CRÍTICA)

**4 migraciones definen/modifican el mismo enum `artifact_state`:**

| Migración | Estados |
|---|---|
| `20240117000001_create_full_schema.sql` | DRAFT, GENERATING, READY_FOR_QA, APPROVED, REJECTED, ESCALATED, COMPLETED |
| `20240117_create_artifacts.sql` | DRAFT, PENDING_QA, IN_PROCESS, APPROVED, ESCALATED, COMPLETED, FAILED |
| `20240117_fix_enum_states.sql` | Agrega 7 valores más |
| `20260211_create_scorm_tables.sql` | Agrega valores SCORM |

**Riesgo**: No hay fuente de verdad clara para los estados válidos.

### 10.2 Indexes Faltantes en Foreign Keys (ALTA)

`20240117000001_create_full_schema.sql` tiene indexes en `state`, `created_by`, `created_at` pero faltan:
- `artifact_id` en tablas hijas
- `materials_id` en `material_lessons`
- `lesson_id` en varias tablas

**Impacto**: Joins lentos a medida que crecen los datos.

### 10.3 RLS Sin Filtro de Organización (ALTA)

```sql
-- 20240117_create_artifacts.sql líneas 40-63:
-- RLS verifica platform_role = 'ADMIN' pero NO filtra por organization_id
-- Un admin de una org puede ver artefactos de TODAS las orgs
```

---

## 11. Configuración y Tooling

### 11.1 ESLint Mínimo

```json
// apps/web/.eslintrc.json — Solo 3 líneas:
{ "extends": "next/core-web-vitals" }
```

**Falta:**
- `@typescript-eslint/no-explicit-any`
- `@typescript-eslint/no-unused-vars`
- `no-console` para src/

### 11.2 SDKs de Gemini Duplicados

| Package | Versión | Ubicación |
|---|---|---|
| `@google/generative-ai` | ^0.24.1 | Root `package.json` |
| `@google/genai` | ^1.38.0 | `apps/web/package.json` |

Dos SDKs diferentes para el mismo servicio. El nuevo (`@google/genai`) es el recomendado.

---

## 12. Plan de Refactorización

### Fase 1: Seguridad y Consolidación de Auth (2 días — CRÍTICA)

**Objetivo**: Eliminar riesgos de seguridad inmediatos.

| Acción | Archivos |
|---|---|
| Crear `_shared/supabase.ts` con `createServiceClient()` | `apps/web/netlify/functions/_shared/supabase.ts` (nuevo) |
| Todas las Netlify functions usan `SUPABASE_SERVICE_ROLE_KEY` | 11 funciones en `netlify/functions/` |
| Agregar validación UUID a inputs de background functions | 11 funciones |
| Estandarizar auth en actions.ts con `getAuthenticatedUser()` | `apps/web/src/app/admin/artifacts/actions.ts` |

**Verificación**: `npm run build` + probar trigger de cada fase del pipeline.

---

### Fase 2: Infraestructura Compartida de Netlify Functions (2 días — ALTA)

**Objetivo**: Eliminar duplicación de boilerplate en 11 funciones.

| Acción | Archivos |
|---|---|
| Crear wrapper `createHandler()` | `_shared/handler.ts` (nuevo) |
| Crear `createGeminiClient()` centralizado | `_shared/gemini.ts` (nuevo) |
| Centralizar constantes (modelos, timeouts, batch sizes) | `_shared/constants.ts` (nuevo) |
| Refactorizar cada función para usar imports compartidos | 11 funciones |

**Verificación**: Trigger de cada background function vía UI.

---

### Fase 3: Dividir actions.ts (3 días — ALTA)

**Objetivo**: Romper el god file de 1578 líneas en módulos enfocados.

| Nuevo Archivo | Funciones | Líneas Aprox |
|---|---|---|
| `actions/_shared.ts` | `getAuthenticatedUser`, `getAccessToken`, `triggerBackgroundFunction`, `ActionResult<T>` | ~50 |
| `actions/artifact-crud.actions.ts` | generate, regenerate, update content/status, delete | ~250 |
| `actions/instructional-plan.actions.ts` | generate, validate, update status/content, delete | ~200 |
| `actions/curation.actions.ts` | start, update row, delete row, clear GPT rows, update status, delete, import JSON | ~400 |
| `actions/materials.actions.ts` | validate, regenerate, mark for fix, save assets, video prompts, production status | ~400 |
| `actions/pipeline.actions.ts` | log event, mark downstream dirty, dismiss upstream dirty, cascade deletes | ~300 |
| `actions.ts` (barrel) | Re-exporta todo | ~30 |

**Mejoras de tipos incluidas**: `any` → tipos propios, URL unificada (resolver 3000 vs 8888).

**Verificación**: `npm run build` + grep de imports.

---

### Fase 4: Eliminar Duplicados y Código Muerto (1 día — MEDIA, paralela con 2-3)

| Acción | Archivos |
|---|---|
| Eliminar tipos de curación duplicados | Eliminar `shared/types/curation.types.ts`, mantener `domains/curation/types/` |
| Consolidar prompts duplicados | Eliminar copia no importada de prompts de plan instruccional |
| Unificar `cn()` | Mantener `lib/utils.ts`, actualizar 3 imports de `shared/utils/cn` |
| Eliminar `html2canvas` | `apps/web/package.json` |
| Limpiar código comentado | `instructional-plan-background.ts`, `validate-plan-background.ts` |
| Eliminar comentario duplicado | `ArtifactClientView.tsx` líneas 30-31 |
| Eliminar `declare const process: any` | `publish/actions.ts` línea 7 |

**Verificación**: `npm run build` + `npm install`.

---

### Fase 5: Type Safety — State Enums y Constantes (2 días — MEDIA)

| Acción | Archivos |
|---|---|
| Crear enums canónicos | `shared/types/states.ts` (nuevo): `ArtifactState`, `SyllabusState`, `CurationState`, `MaterialState`, `ProductionState` |
| Reemplazar magic strings de estado | Todos los archivos que usan strings de estado |
| Crear discriminated union para `MaterialContent` | `domains/materials/types/materials.types.ts` |
| Corregir `severity: 'error'` en validators que pasan | `domains/materials/validators/materials.validators.ts` (9 líneas) |

**Verificación**: `npm run build` (TypeScript detecta strings no encontrados).

---

### Fase 6: Dividir God Components (3 días — MEDIA)

#### SourcesCurationGenerationContainer.tsx (1179 → ~5 archivos)

| Archivo | Responsabilidad |
|---|---|
| `CurationGenerationContainer.tsx` | Orquestador (state machine, data fetching) |
| `CurationSourceTable.tsx` | Tabla de fuentes con edición inline |
| `CurationQAPanel.tsx` | UI de revisión/aprobación QA |
| `CurationProgressBar.tsx` | Barra de progreso |
| `hooks/useCurationGeneration.ts` | Hook de estado/polling |

#### InstructionalPlanGenerationContainer.tsx (935 → ~5 archivos)

| Archivo | Responsabilidad |
|---|---|
| `PlanGenerationContainer.tsx` | Orquestador |
| `PlanModuleTree.tsx` | Vista árbol módulos/lecciones |
| `PlanLessonDetail.tsx` | Detalle de plan por lección |
| `PlanValidationPanel.tsx` | Resultados de validación |
| `hooks/usePlanGeneration.ts` | Hook de generación |

#### ProductionAssetCard.tsx (822 → ~5 archivos)

| Archivo | Responsabilidad |
|---|---|
| `ProductionAssetCard.tsx` | Contenedor reducido |
| `SlidesDeckSection.tsx` | UI de slides Gamma |
| `VideoProductionSection.tsx` | UI de video/B-roll |
| `AssetUploadDropzone.tsx` | Área de upload |
| `ProductionChecklist.tsx` | Checklist DoD |

#### ChatWindow.tsx (683 → ~5 archivos)

| Archivo | Responsabilidad |
|---|---|
| `ChatWindow.tsx` | Contenedor (~200 líneas) |
| `ChatInput.tsx` | Input con detección de modo |
| `services/ChatActionExecutor.ts` | Ejecución de acciones (aplanar 7-8 niveles) |
| `hooks/useLiaChat.ts` | Hook de estado del chat |
| `config/lia-action-patterns.ts` | 60+ regex patterns extraídos |

**Verificación**: QA visual de cada página del pipeline.

---

### Fase 7: Refactorizar unified-curation-logic.ts (2 días — MEDIA)

| Acción | Archivos |
|---|---|
| Extraer validación de URLs | `_shared/url-validator.ts` (nuevo) |
| Extraer procesamiento por batch | `curation-batch-processor.ts` (nuevo) |
| Extraer búsqueda de fuentes | `curation-source-finder.ts` (nuevo) |
| Extraer validación de fuentes | `curation-source-validator.ts` (nuevo) |
| Reducir función principal | `unified-curation-logic.ts` → ~150 líneas como orquestador |

**Verificación**: Ejecutar curación en artefacto de prueba, comparar resultados.

---

### Fase 8: Tooling y Configuración (1 día — BAJA)

| Acción | Archivos |
|---|---|
| Agregar reglas ESLint | `.eslintrc.json`: `no-explicit-any` (warn), `no-unused-vars` (error), `no-console` (warn para src/) |
| Migrar a SDK unificado | Eliminar `@google/generative-ai`, usar `@google/genai` |
| Logging estructurado | Crear logger simple para Netlify functions |

**Verificación**: `npm run lint` + `npm run build`.

---

### Secuenciación

```
Semana 1:
  Fase 1 (seguridad) ──→ Fase 2 (infra netlify) ──→ Fase 3 (split actions)
  Fase 4 (dedup) ─────── en paralelo ──────────────────────────────────────→

Semana 2:
  Fase 5 (type safety) ──→ Fase 6 (split components)
  Fase 7 (curation) ──────── en paralelo ──→ Fase 8 (tooling)
```

**Camino crítico**: ~10 días (Fases 1 → 2 → 3 → 5 → 6)

---

### Fuera de Alcance (Deliberadamente)

| Tema | Razón |
|---|---|
| Consolidar migraciones SQL de enum | PostgreSQL maneja `ADD VALUE IF NOT EXISTS`; deuda cosmética |
| Agregar indexes faltantes en FK | Requiere medición con `pg_stat_user_tables` antes de actuar |
| RLS con filtro por `organization_id` | Requiere entender el modelo multi-tenant; workstream separado |
| Rate limiting en background functions | Decisión de infraestructura (Netlify built-in vs app-level) |
| N+1 queries en validators | Optimización de performance; investigación separada |
