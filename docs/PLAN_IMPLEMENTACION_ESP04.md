# Plan de Implementacion ESP-04 (Paso 4 / Fase 2): Curaduria de Fuentes

## Resumen Ejecutivo

ESP-04 toma el Plan Instruccional del Paso 3 y produce una tabla de mapeo **Leccion -> Componente -> Fuentes** con validaciones de aptitud y cobertura. Incluye bitacora de decisiones y gestion de bloqueadores.

---

## 1. Estructura de Dominio

Siguiendo el patron existente, crear `src/domains/curation/`:

```
src/domains/curation/
├── components/
│   ├── CurationForm.tsx          # Formulario principal (iniciar curaduria)
│   ├── SourcesTable.tsx          # Tabla editable Leccion->Componente->Fuente
│   ├── SourceRow.tsx             # Fila individual con controles apta/cobertura
│   ├── CurationBitacora.tsx      # Visor de bitacora
│   ├── CurationBlockers.tsx      # Panel de bloqueadores
│   └── CurationDodChecklist.tsx  # Checklist DoD Fase 2
├── hooks/
│   └── useCuration.ts            # Hook principal
├── services/
│   └── curation.service.ts       # Logica de negocio
├── validators/
│   └── curation.validators.ts    # Validaciones deterministas
├── types/
│   └── curation.types.ts         # Tipos TypeScript
└── index.ts                      # Barrel exports
```

---

## 2. Tipos (curation.types.ts)

```typescript
// Estados del Paso 4
export type Esp04StepState =
  | 'PHASE2_DRAFT'
  | 'PHASE2_GENERATING'
  | 'PHASE2_GENERATED'
  | 'PHASE2_HITL_REVIEW'
  | 'PHASE2_READY_FOR_QA'
  | 'PHASE2_APPROVED'
  | 'PHASE2_CORRECTABLE'
  | 'PHASE2_BLOCKED'

// Fila de la tabla de fuentes
export interface CurationRow {
  id: string
  lesson_id: string
  lesson_title: string
  component: string
  is_critical: boolean
  source_ref: string           // URL o titulo
  source_title?: string
  apta: boolean | null         // null = pendiente evaluacion
  motivo_no_apta?: string
  cobertura_completa: boolean | null
  notes?: string
}

// Entrada de bitacora
export interface BitacoraEntry {
  id: string
  entry_type: 'DECISION' | 'DISCARD' | 'GAP' | 'NEXT_STEP' | 'NOTE'
  lesson_id?: string
  component?: string
  message: string
  created_at: string
  created_by?: string
}

// Bloqueador de curaduria
export interface CurationBlocker {
  id: string
  lesson_id: string
  lesson_title: string
  component: string
  impact: string
  owner: string
  status: 'OPEN' | 'MITIGATING' | 'ACCEPTED'
  created_at: string
}

// Payload completo de curaduria
export interface CurationPayload {
  artifact_id: string
  attempt_number: 1 | 2
  rows: CurationRow[]
  bitacora: BitacoraEntry[]
  blockers: CurationBlocker[]
  dod: {
    checklist: CurationDodCheck[]
    automatic_checks: ValidationCheck[]
  }
  state: Esp04StepState
  qa_decision?: {
    decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED'
    reviewed_by?: string
    reviewed_at?: string
    notes?: string
  }
}

// Check DoD
export interface CurationDodCheck {
  code: 'DOD_COVERAGE' | 'DOD_CRITICAL' | 'DOD_OPERABILITY' | 'DOD_TRACEABILITY'
  label: string
  pass: boolean
  evidence?: string
  notes?: string
}

// Resultado de validacion
export interface ValidationCheck {
  code: string
  pass: boolean
  message: string
  severity: 'error' | 'warning'
  lesson_id?: string
  component?: string
}
```

---

## 3. API Route (/api/curation)

Archivo: `src/app/api/curation/route.ts`

### Responsabilidades:
1. Recibir el plan instruccional (lecciones + componentes)
2. Generar con Gemini fuentes candidatas para cada componente
3. Retornar estructura parseable para que HITL marque aptitud/cobertura

### Prompt para Gemini:
```
Para cada leccion y componente, sugiere 2-3 fuentes candidatas:
- Titulo/nombre de la fuente
- URL o referencia
- Breve justificacion de por que es relevante

Formato JSON:
{
  "sources_by_lesson": [
    {
      "lesson_id": "...",
      "lesson_title": "...",
      "components": [
        {
          "component_name": "DIALOGUE",
          "is_critical": true,
          "candidate_sources": [
            {
              "title": "...",
              "url": "...",
              "rationale": "..."
            }
          ]
        }
      ]
    }
  ]
}
```

### Reintentos:
- Si Intento 1 falla validacion de cobertura -> permitir Intento 2
- Intento 2 recibe contexto de gaps del Intento 1

---

## 4. Validadores (curation.validators.ts)

### V01: Cobertura por Componente
```typescript
// Para cada (lesson, component) requerido:
// Existe >=1 row con apta=true AND cobertura_completa=true
function validateCoveragePerComponent(
  rows: CurationRow[],
  requiredComponents: { lesson_id: string; component: string }[]
): ValidationCheck
```

### V02: Criticos Requieren Cobertura Completa
```typescript
// Si is_critical=true, entonces cobertura_completa debe ser true
function validateCriticalCoverage(rows: CurationRow[]): ValidationCheck
```

### V03: NO APTA Requiere Motivo
```typescript
// Si apta=false, motivo_no_apta no puede estar vacio
function validateNoAptaHasReason(rows: CurationRow[]): ValidationCheck
```

### V04: Componente Sin Fuente Apta
```typescript
// Si un componente solo tiene fuentes apta=false, es un gap
function validateNoOrphanComponents(
  rows: CurationRow[],
  requiredComponents: { lesson_id: string; component: string }[]
): ValidationCheck
```

### V05: Maximo de Intentos
```typescript
// attempt_number <= 2
function validateMaxAttempts(attemptNumber: number): ValidationCheck
```

---

## 5. Servicio (curation.service.ts)

### Metodos Principales:

```typescript
export const curationService = {
  // Iniciar curaduria (desde Paso 3 aprobado)
  async startCuration(artifactId: string): Promise<CurationResult>

  // Ejecutar pipeline (llamar API, generar filas)
  async runPipeline(artifactId: string, lessonPlans: LessonPlan[]): Promise<void>

  // Obtener estado actual
  async getCuration(artifactId: string): Promise<CurationPayload | null>

  // HITL: Marcar fila como apta/no apta
  async updateRow(artifactId: string, rowId: string, updates: Partial<CurationRow>): Promise<void>

  // HITL: Agregar entrada a bitacora
  async addBitacoraEntry(artifactId: string, entry: Omit<BitacoraEntry, 'id' | 'created_at'>): Promise<void>

  // Ejecutar Intento 2 (iteracion dirigida)
  async runAttempt2(artifactId: string, gaps: string[]): Promise<void>

  // Enviar a QA
  async submitToQA(artifactId: string): Promise<void>

  // QA: Aplicar decision
  async applyQADecision(
    artifactId: string,
    decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED',
    notes?: string
  ): Promise<void>

  // Crear bloqueador
  async addBlocker(artifactId: string, blocker: Omit<CurationBlocker, 'id' | 'created_at'>): Promise<void>
}
```

---

## 6. Componentes UI

### 6.1 CurationForm.tsx
- Muestra estado actual de curaduria
- Boton "Iniciar Curaduria" si Paso 3 aprobado
- Tabs: Tabla / Bitacora / Bloqueadores / DoD

### 6.2 SourcesTable.tsx
- Tabla con columnas: Leccion | Componente | Critico | Fuente | Apta | Motivo | Cobertura
- Filas editables para marcar apta/cobertura
- Indicadores visuales:
  - Verde: apta + cobertura completa
  - Amarillo: pendiente evaluacion
  - Rojo: no apta o sin cobertura

### 6.3 SourceRow.tsx
```tsx
interface SourceRowProps {
  row: CurationRow
  onUpdate: (updates: Partial<CurationRow>) => void
  readOnly?: boolean
}
```
- Selector apta: Si/No
- Campo motivo (aparece si apta=No)
- Selector cobertura: Completa/Parcial
- Notas opcionales

### 6.4 CurationBitacora.tsx
- Lista cronologica de entradas
- Filtro por tipo (DECISION, DISCARD, GAP, etc.)
- Boton para agregar nueva entrada

### 6.5 CurationBlockers.tsx
- Lista de bloqueadores
- Estado por bloqueador (OPEN, MITIGATING, ACCEPTED)
- Boton para agregar bloqueador manual

### 6.6 CurationDodChecklist.tsx
- Checklist visual de DoD Fase 2:
  - [ ] Cobertura por leccion
  - [ ] Componentes criticos cubiertos
  - [ ] Fuentes NO APTA con motivo
  - [ ] Bitacora completa

---

## 7. Integracion con ArtifactViewer

Agregar **Paso 4** como tab adicional en `ArtifactViewer.tsx`:

```tsx
<TabsTrigger value="paso4" className="flex items-center gap-2">
  <Library className="h-4 w-4" />
  Paso 4: Curaduria
  {curation?.state === 'PHASE2_APPROVED' && (
    <CheckCircle className="h-4 w-4 text-green-500" />
  )}
</TabsTrigger>

<TabsContent value="paso4">
  {!isPaso3Approved ? (
    <PendingMessage paso={3} />
  ) : (
    <CurationForm artifactId={artifactId} />
  )}
</TabsContent>
```

---

## 8. Flujo de Estados

```
PHASE2_DRAFT
    |
    v (iniciar curaduria)
PHASE2_GENERATING
    |
    v (IA genera fuentes candidatas)
PHASE2_GENERATED
    |
    v (operador marca apta/cobertura)
PHASE2_HITL_REVIEW
    |
    v (validacion pasa o bloqueadores documentados)
PHASE2_READY_FOR_QA
    |
    +---> PHASE2_APPROVED (QA aprueba)
    |
    +---> PHASE2_CORRECTABLE (QA pide ajustes)
    |         |
    |         v (si intento 2 no usado, permitir)
    |     PHASE2_GENERATING (intento 2)
    |
    +---> PHASE2_BLOCKED (bloqueadores confirmados)
```

---

## 9. Orden de Implementacion

### Fase A: Tipos y Estructura Base
1. Crear `curation.types.ts` con todos los tipos
2. Crear `index.ts` con barrel exports

### Fase B: API y Servicio
3. Crear `/api/curation/route.ts` con Gemini
4. Crear `curation.service.ts`
5. Crear `curation.validators.ts`

### Fase C: Hook
6. Crear `useCuration.ts`

### Fase D: Componentes UI
7. `SourceRow.tsx` (componente base)
8. `SourcesTable.tsx`
9. `CurationBitacora.tsx`
10. `CurationBlockers.tsx`
11. `CurationDodChecklist.tsx`
12. `CurationForm.tsx` (componente principal)

### Fase E: Integracion
13. Agregar Paso 4 tab en `ArtifactViewer.tsx`
14. Actualizar `utils.ts` con estados PHASE2_*
15. Testing end-to-end

---

## 10. Consideraciones Especiales

### HITL (Human-in-the-Loop)
- El operador DEBE marcar manualmente apta/cobertura
- La IA solo sugiere fuentes candidatas
- La bitacora documenta decisiones del operador

### Intento 2 (Iteracion Dirigida)
- Solo se activa si Intento 1 tiene gaps
- Recibe contexto de que componentes faltan
- Si tras Intento 2 persiste gap -> bloqueador automatico

### QA Decision XOR
- APPROVED: Todo cubierto, listo para siguiente paso
- CORRECTABLE: Ajustes menores, puede volver a HITL
- BLOCKED: Bloqueadores confirmados, requiere escalacion

---

## 11. Dependencias

- Requiere Paso 3 (ESP-03) aprobado
- Usa misma estructura de API que ESP-01/02/03
- Comparte utilidades (`getStateLabel`, `getStateColor`)
- Patron de dominio consistente con codebase existente
