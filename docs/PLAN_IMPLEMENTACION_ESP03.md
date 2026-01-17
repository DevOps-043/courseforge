# Plan de Implementación GO-ESP-03: Plan Instruccional

## Resumen Ejecutivo

ESP-03 toma el **Temario aprobado (ESP-02)** y genera un **Plan Instruccional por lección** con:
- Componentes obligatorios: Diálogo, Lectura, Quiz
- Componentes opcionales: Demo/Guía, Ejercicio, Recurso
- Gestión de bloqueadores
- Validación DoD (Definition of Done)
- Control HITL con rol de **Arquitecto del Curso**

---

## 1. Arquitectura General

### 1.1 Flujo del Pipeline

```
ESP-02 (Temario Aprobado)
         ↓
    [API /api/instructional-plan]
         ↓
    Gemini genera plan por lección
         ↓
    Validaciones V01-V05 (automáticas)
         ↓
    Reintentos si falla (máx 3 por validación)
         ↓
    Validaciones S01-S03 (semánticas con IA)
         ↓
    STEP_READY_FOR_REVIEW
         ↓
    Arquitecto revisa (HITL)
         ↓
    STEP_APPROVED | STEP_WITH_BLOCKERS
```

### 1.2 Estados del Step

| Estado | Descripción |
|--------|-------------|
| `STEP_DRAFT` | Sin plan generado |
| `STEP_GENERATING` | Generando con IA |
| `STEP_VALIDATING` | Ejecutando validaciones |
| `STEP_READY_FOR_REVIEW` | Listo para revisión del Arquitecto |
| `STEP_APPROVED` | Aprobado Fase 1 |
| `STEP_WITH_BLOCKERS` | Con bloqueadores registrados |
| `STEP_ESCALATED` | Escalado (máx iteraciones o fallas críticas) |

---

## 2. Modelo de Datos

### 2.1 Tipos TypeScript

```typescript
// src/domains/instructionalPlan/types/instructionalPlan.types.ts

export type Esp03StepState =
  | 'STEP_DRAFT'
  | 'STEP_GENERATING'
  | 'STEP_VALIDATING'
  | 'STEP_READY_FOR_REVIEW'
  | 'STEP_APPROVED'
  | 'STEP_WITH_BLOCKERS'
  | 'STEP_ESCALATED'

export type Esp03FinalStatus = 'APPROVED_PHASE_1' | 'WITH_BLOCKERS'

export type PlanComponentType =
  | 'DIALOGUE'
  | 'READING'
  | 'QUIZ'
  | 'DEMO_GUIDE'
  | 'EXERCISE'
  | 'RESOURCE'

export interface PlanComponent {
  type: PlanComponentType
  summary: string
  notes?: string
}

export interface LessonPlan {
  lesson_id: string
  lesson_title: string
  oa_text: string                    // Objetivo de aprendizaje
  oa_bloom_verb?: string             // Verbo Bloom extraído
  measurable_criteria?: string       // Criterio medible
  components: PlanComponent[]        // Mínimo: DIALOGUE, READING, QUIZ
  alignment_notes?: string           // Notas de alineación OA↔contenido
}

export interface Blocker {
  id: string
  lesson_id?: string
  title: string
  description: string
  impact: 'LOW' | 'MEDIUM' | 'HIGH'
  owner: string
  status: 'OPEN' | 'RESOLVED' | 'WONT_FIX'
}

export interface DodCheck {
  code: 'DOD_A' | 'DOD_B' | 'DOD_C' | 'DOD_D'
  pass: boolean
  evidence?: string
  notes?: string
}

export interface ValidationCheck {
  code: string
  pass: boolean
  message?: string
}

export interface Esp03PlanPayload {
  source: {
    temario_version_id?: string
    artifact_id: string
  }
  lesson_plans: LessonPlan[]
  blockers: Blocker[]
  dod: {
    checklist: DodCheck[]
    automatic_checks: ValidationCheck[]
  }
  iteration_count: number
  final_status?: Esp03FinalStatus
  approvals: {
    architect_status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reviewed_by?: string
    reviewed_at?: string
    notes?: string
  }
}

export interface Esp03GenerationInput {
  artifactId: string
}

export interface Esp03GenerationResult {
  success: boolean
  state: Esp03StepState
  error?: string
}
```

---

## 3. API Route: `/api/instructional-plan`

### 3.1 Endpoint POST

```typescript
// src/app/api/instructional-plan/route.ts

POST /api/instructional-plan
Body: {
  lessons: Array<{
    id: string
    title: string
    objective_specific: string
    module_title: string
  }>
  ideaCentral: string
  courseName: string
}

Response: {
  lesson_plans: LessonPlan[]
  blockers: Blocker[]
}
```

### 3.2 Lógica de Generación con Gemini

1. **Prompt inicial**: Genera plan para TODAS las lecciones
2. **Validación V01-V05**: Checks automáticos
3. **Reintentos específicos** (máx 3 cada uno):
   - Si V01 falla → regenerar lecciones faltantes
   - Si V03 falla → regenerar componentes faltantes
   - Si V04/V05 falla → regenerar con correcciones
4. **Validaciones semánticas S01-S03**: Con IA
5. **Retornar plan validado**

### 3.3 Prompt Principal

```
Eres un experto en diseño instruccional. Genera un plan instruccional detallado.

**CURSO:** {courseName}
**IDEA CENTRAL:** {ideaCentral}

**LECCIONES A PLANIFICAR:**
{lessons.map(l => `- ${l.id}: ${l.title}\n  OA: ${l.objective_specific}`)}

**REGLAS OBLIGATORIAS:**
1. Genera un plan para CADA lección (sin omitir ninguna)
2. Cada lección DEBE incluir estos componentes obligatorios:
   - DIALOGUE: Descripción del diálogo/conversación instructiva
   - READING: Material de lectura planificado
   - QUIZ: Evaluación/cuestionario planificado
3. Incluir componentes opcionales si el OA lo requiere:
   - DEMO_GUIDE: Si el OA implica demostración práctica
   - EXERCISE: Si requiere ejercicios adicionales
   - RESOURCE: Recursos complementarios
4. El OA debe ser operable: verbo Bloom + criterio medible
5. Coherencia entre OA y componentes planificados

**FORMATO JSON:**
{
  "lesson_plans": [
    {
      "lesson_id": "id exacto de la lección",
      "lesson_title": "título exacto",
      "oa_text": "objetivo de aprendizaje completo",
      "oa_bloom_verb": "verbo principal (ej: Aplicar)",
      "measurable_criteria": "cómo se medirá el logro",
      "components": [
        {"type": "DIALOGUE", "summary": "descripción del diálogo"},
        {"type": "READING", "summary": "descripción del material"},
        {"type": "QUIZ", "summary": "descripción de evaluación"}
      ],
      "alignment_notes": "notas sobre alineación OA↔contenido"
    }
  ],
  "blockers": []
}
```

---

## 4. Validaciones

### 4.1 Validaciones Automáticas (V01-V05)

| Código | Regla | Mensaje |
|--------|-------|---------|
| V01 | `lesson_plans.count == temario.lessons.count` | Todas las lecciones deben estar incluidas |
| V02 | `oa_text.length >= 20` para cada lección | Cada lección debe tener OA definido |
| V03 | `has(DIALOGUE) && has(READING) && has(QUIZ)` | Componentes obligatorios presentes |
| V04 | Si `blockers.length == 0`, evidencia DoD_D | Bloqueadores documentados o "Sin bloqueadores" |
| V05 | `iteration_count <= 2` | Máximo 2 iteraciones (escalar si excede) |

### 4.2 Validaciones Semánticas (S01-S03) - Con IA

| Código | Regla | Descripción |
|--------|-------|-------------|
| S01 | OA operable | Verbo Bloom + criterio medible presente |
| S02 | OA↔componentes coherente | Si OA implica práctica → DEMO_GUIDE presente |
| S03 | Sin contradicciones | OA avanzado no tiene contenido introductorio |

### 4.3 Reintentos por Validación

```typescript
// Pseudocódigo
if (!V01.passed) {
  // Identificar lecciones faltantes
  // Prompt: "Genera plan SOLO para estas lecciones: {missing}"
  // Reintentar máx 3 veces
}

if (!V03.passed) {
  // Identificar lecciones sin componentes obligatorios
  // Prompt: "Agrega los componentes faltantes a: {lessons}"
  // Reintentar máx 3 veces
}

if (!S02.passed) {
  // Prompt: "El OA de {lesson} implica práctica pero falta DEMO_GUIDE"
  // Reintentar máx 3 veces
}
```

---

## 5. Servicio del Dominio

### 5.1 Estructura de Archivos

```
src/domains/instructionalPlan/
├── types/
│   └── instructionalPlan.types.ts
├── services/
│   └── instructionalPlan.service.ts
├── validators/
│   └── instructionalPlan.validators.ts
├── hooks/
│   └── useInstructionalPlan.ts
├── components/
│   ├── InstructionalPlanViewer.tsx
│   ├── LessonPlanCard.tsx
│   ├── ComponentChips.tsx
│   ├── BlockersPanel.tsx
│   ├── DodChecklist.tsx
│   └── ArchitectReviewPanel.tsx
└── index.ts
```

### 5.2 Funciones del Servicio

```typescript
// instructionalPlan.service.ts

export const instructionalPlanService = {
  // Iniciar generación
  async startGeneration(artifactId: string): Promise<Esp03GenerationResult>

  // Obtener plan actual
  async getPlan(artifactId: string): Promise<Esp03PlanPayload | null>

  // Obtener estado
  async getState(artifactId: string): Promise<Esp03StepState>

  // Enviar a revisión del Arquitecto
  async submitForArchitectReview(artifactId: string): Promise<void>

  // Aplicar decisión del Arquitecto
  async applyArchitectDecision(
    artifactId: string,
    decision: 'APPROVED' | 'WITH_BLOCKERS',
    notes?: string,
    blockers?: Blocker[]
  ): Promise<void>

  // Agregar bloqueador
  async addBlocker(artifactId: string, blocker: Omit<Blocker, 'id'>): Promise<void>

  // Actualizar bloqueador
  async updateBlocker(artifactId: string, blockerId: string, updates: Partial<Blocker>): Promise<void>

  // Regenerar (nueva iteración)
  async regenerate(artifactId: string): Promise<Esp03GenerationResult>

  // Escalar
  async escalate(artifactId: string, reason: string): Promise<void>
}
```

---

## 6. Componentes UI

### 6.1 Vista Principal del Plan

```tsx
// InstructionalPlanViewer.tsx
- Tabs por módulo
- Cards por lección expandibles
- Chips de componentes (DIALOGUE, READING, QUIZ, etc.)
- Indicador de validación por lección
- Panel lateral de bloqueadores
```

### 6.2 Panel de Bloqueadores

```tsx
// BlockersPanel.tsx
- Lista de bloqueadores con:
  - Título y descripción
  - Impacto (LOW/MEDIUM/HIGH) con colores
  - Responsable asignado
  - Estado (OPEN/RESOLVED/WONT_FIX)
- Botón "Agregar bloqueador"
- Edición inline
```

### 6.3 Checklist DoD

```tsx
// DodChecklist.tsx
- DOD_A: Completitud ✓/✗
- DOD_B: Calidad instruccional ✓/✗
- DOD_C: Componentes obligatorios ✓/✗
- DOD_D: Bloqueadores documentados ✓/✗
- Evidencia por cada check
```

### 6.4 Panel de Revisión del Arquitecto

```tsx
// ArchitectReviewPanel.tsx
- Resumen de validaciones
- Checklist DoD completado
- Botones:
  - "Aprobar Fase 1" → STEP_APPROVED
  - "Marcar con bloqueadores" → STEP_WITH_BLOCKERS
- Campo de notas obligatorio si hay bloqueadores
```

---

## 7. Integración con UI Existente

### 7.1 Modificar ArtifactViewer.tsx

```tsx
// Agregar Tab "Paso 3: Plan Instruccional"
<TabsTrigger value="paso3">
  Paso 3: Plan Instruccional
</TabsTrigger>

<TabsContent value="paso3">
  {!isPaso2Approved ? (
    <PendingMessage step={2} />
  ) : (
    <InstructionalPlanForm artifactId={artifactId} />
  )}
</TabsContent>
```

### 7.2 Página de Revisión

Reutilizar `/qa/[id]` con selector de step:
- Paso 1: QA tradicional
- Paso 2: QA tradicional
- Paso 3: Revisión del Arquitecto

---

## 8. Tareas de Implementación

### Fase 1: Tipos y API (Día 1)

- [ ] Crear `instructionalPlan.types.ts`
- [ ] Crear `/api/instructional-plan/route.ts`
- [ ] Implementar prompt principal con Gemini
- [ ] Implementar validaciones V01-V05
- [ ] Implementar reintentos por validación fallida

### Fase 2: Servicio y Validadores (Día 2)

- [ ] Crear `instructionalPlan.validators.ts`
- [ ] Crear `instructionalPlan.service.ts`
- [ ] Implementar validaciones semánticas S01-S03
- [ ] Crear `useInstructionalPlan.ts` hook

### Fase 3: Componentes UI (Día 3)

- [ ] Crear `LessonPlanCard.tsx`
- [ ] Crear `ComponentChips.tsx`
- [ ] Crear `InstructionalPlanViewer.tsx`
- [ ] Crear `BlockersPanel.tsx`

### Fase 4: Revisión y DoD (Día 4)

- [ ] Crear `DodChecklist.tsx`
- [ ] Crear `ArchitectReviewPanel.tsx`
- [ ] Integrar en ArtifactViewer
- [ ] Modificar página QA para Paso 3

### Fase 5: Testing y Refinamiento (Día 5)

- [ ] Probar flujo completo
- [ ] Ajustar prompts según resultados
- [ ] Documentar edge cases
- [ ] Optimizar reintentos

---

## 9. Dependencias

### 9.1 Prerequisitos

- ESP-02 debe estar completamente implementado
- Temario debe estar en estado `STEP_APPROVED`

### 9.2 Paquetes

No se requieren paquetes adicionales. Se usa:
- `@google/generative-ai` (ya instalado)
- Componentes UI existentes

---

## 10. Notas de Implementación

### 10.1 Sin Datos Hardcodeados

Todo el contenido será generado por Gemini:
- Planes instruccionales
- Componentes
- Notas de alineación
- Criterios medibles

### 10.2 Manejo de Errores

- Si Gemini falla → reintentar hasta 3 veces
- Si persisten fallas → STEP_ESCALATED
- Logs detallados en consola del servidor

### 10.3 Consideraciones de UX

- Mostrar progreso de generación
- Indicadores visuales por componente
- Colores por impacto de bloqueadores
- Confirmación antes de decisiones finales
