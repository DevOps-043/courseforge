# Plan de Implementacion GO-ESP-02

## Resumen

Integrar el Paso 2 (Generacion de Temario) al sitio web existente de GO-ESP-01. El ESP-02 transforma el artefacto del Paso 1 (nombre + descripcion + objetivos) en un temario estructurado con modulos y lecciones.

---

## Fase 1: Tipos y Modelo de Datos

### 1.1 Crear tipos del dominio syllabus

**Archivo:** `src/domains/syllabus/types/syllabus.types.ts`

```typescript
export type Esp02Route = "A_WITH_SOURCE" | "B_NO_SOURCE"

export type Esp02StepState =
  | "STEP_DRAFT"
  | "STEP_GENERATING"
  | "STEP_VALIDATING"
  | "STEP_READY_FOR_QA"
  | "STEP_APPROVED"
  | "STEP_REJECTED"
  | "STEP_ESCALATED"

export interface SyllabusLesson {
  id: string
  title: string
  objective_specific: string
}

export interface SyllabusModule {
  id: string
  objective_general_ref: string
  title: string
  lessons: SyllabusLesson[]
}

export interface SourceFile {
  file_id: string
  filename: string
  mime: string
}

export interface TemarioEsp02 {
  route: Esp02Route
  source_summary?: {
    files: SourceFile[]
    notes?: string
    utilizable?: boolean
  }
  modules: SyllabusModule[]
  validation: {
    automatic_pass: boolean
    checks: ValidationCheck[]
    route_specific?: ValidationCheck[]
  }
  qa: {
    status: "PENDING" | "APPROVED" | "REJECTED"
    reviewed_by?: string
    reviewed_at?: string
    notes?: string
  }
}

export interface ValidationCheck {
  code: string
  pass: boolean
  message?: string
  observed?: any
}
```

### 1.2 Extender tipos de Artifact

**Archivo:** `src/shared/types/database.types.ts`

Agregar a la interfaz Artifact:
```typescript
temario?: TemarioEsp02
esp02_state?: Esp02StepState
esp02_iteration_count?: number
```

---

## Fase 2: Estructura del Dominio Syllabus

### 2.1 Crear estructura de carpetas

```
src/domains/syllabus/
├── components/
│   ├── SyllabusViewer.tsx        # Visualiza modulos/lecciones
│   ├── SyllabusRouteSelector.tsx # Selector Ruta A/B
│   ├── SourceUploader.tsx        # Upload de fuentes (Ruta A)
│   ├── SyllabusGenerationForm.tsx # Formulario de generacion
│   └── SyllabusQAView.tsx        # Vista de revision QA
├── hooks/
│   ├── useSyllabus.ts            # Hook principal
│   └── useSyllabusProgress.ts    # Progreso de generacion
├── services/
│   └── syllabus.service.ts       # Logica de negocio
├── validators/
│   └── syllabus.validators.ts    # Validaciones V01-V05
├── types/
│   └── syllabus.types.ts
└── index.ts                      # Barrel export
```

---

## Fase 3: Servicio Mock (syllabus.service.ts)

### 3.1 Funciones principales

```typescript
// syllabus.service.ts
export const syllabusService = {
  // Iniciar generacion ESP-02
  startEsp02Generation(artifactId: string, route: Esp02Route, sourceFiles?: File[])

  // Obtener estado del temario
  getTemario(artifactId: string): Promise<TemarioEsp02 | null>

  // Ejecutar validaciones automaticas
  validateEsp02(artifactId: string): Promise<ValidationResult>

  // Enviar a QA
  submitToQa(artifactId: string): Promise<void>

  // Aplicar decision QA
  applyQaDecision(artifactId: string, decision: "APPROVED" | "REJECTED", notes?: string)

  // Re-generar (iteracion)
  regenerate(artifactId: string, corrections?: string): Promise<void>
}
```

### 3.2 Generacion mock con delays

Simular:
1. STEP_GENERATING (3 seg)
2. STEP_VALIDATING (2 seg)
3. STEP_READY_FOR_QA

---

## Fase 4: Validadores Automaticos

### 4.1 Crear validadores

**Archivo:** `src/domains/syllabus/validators/syllabus.validators.ts`

```typescript
// V01: Modulos = Objetivos generales
validateModulesMatchObjectives(modules, objetivos_generales)

// V02: 3-6 lecciones por modulo
validateLessonsRange(modules)

// V03: Objetivos especificos no vacios (min 12 chars)
validateObjectivesPresent(modules)

// V04: No duplicados
validateNoDuplicates(modules)

// V05: Estructura completa
validateStructureComplete(modules)

// Ejecutar todas
runAllValidations(temario, artifact): ValidationResult
```

---

## Fase 5: Componentes UI

### 5.1 SyllabusRouteSelector

```tsx
// Selector de ruta con descripcion
<RadioGroup>
  <Radio value="B_NO_SOURCE">
    Ruta B - Sin fuente (IA genera contenido)
  </Radio>
  <Radio value="A_WITH_SOURCE">
    Ruta A - Con fuente primaria
  </Radio>
</RadioGroup>
```

### 5.2 SyllabusViewer

```tsx
// Visualiza el temario generado
<Card>
  {modules.map(module => (
    <ModuleCard key={module.id}>
      <ModuleTitle>{module.title}</ModuleTitle>
      <ObjectiveGeneral>{module.objective_general_ref}</ObjectiveGeneral>
      <LessonsList>
        {module.lessons.map(lesson => (
          <LessonItem>
            <LessonTitle>{lesson.title}</LessonTitle>
            <LessonObjective>{lesson.objective_specific}</LessonObjective>
          </LessonItem>
        ))}
      </LessonsList>
    </ModuleCard>
  ))}
</Card>
```

### 5.3 SyllabusQAView

```tsx
// Vista de revision QA
<Card>
  <ValidationChecklist checks={temario.validation.checks} />
  <SyllabusViewer modules={temario.modules} />
  <QAActions>
    <Button onClick={approve}>Aprobar</Button>
    <Button onClick={reject}>Rechazar</Button>
  </QAActions>
  <TextArea placeholder="Observaciones..." />
</Card>
```

---

## Fase 6: Modificar Paginas Existentes

### 6.1 /artifacts/[id]/page.tsx

Agregar seccion "Paso 2 - Temario":

```tsx
<Tabs>
  <Tab value="paso1">Paso 1 - Artefacto Base</Tab>
  <Tab value="paso2">Paso 2 - Temario</Tab>
</Tabs>

<TabContent value="paso2">
  {!temario ? (
    <SyllabusGenerationForm artifactId={id} />
  ) : (
    <SyllabusViewer temario={temario} />
  )}
</TabContent>
```

### 6.2 /qa/page.tsx

Agregar filtro por paso:

```tsx
<Select>
  <Option value="all">Todos los pasos</Option>
  <Option value="GO-ESP-01">Paso 1 - Artefacto</Option>
  <Option value="GO-ESP-02">Paso 2 - Temario</Option>
</Select>
```

### 6.3 /qa/[id]/page.tsx

Agregar modo step:

```tsx
<Tabs>
  <Tab value="esp01">Revision Paso 1</Tab>
  <Tab value="esp02">Revision Paso 2</Tab>
</Tabs>

<TabContent value="esp02">
  <SyllabusQAView artifactId={id} />
</TabContent>
```

---

## Fase 7: Base de Datos (SQL)

### 7.1 Opcion A: Extender tabla artifacts

```sql
ALTER TABLE artifacts ADD COLUMN temario JSONB;
ALTER TABLE artifacts ADD COLUMN esp02_state TEXT;
ALTER TABLE artifacts ADD COLUMN esp02_iteration_count INTEGER DEFAULT 0;
```

### 7.2 Opcion B: Nueva tabla artifact_steps (recomendada)

```sql
CREATE TABLE artifact_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL, -- 'GO-ESP-01', 'GO-ESP-02', etc.
  state TEXT NOT NULL DEFAULT 'STEP_DRAFT',
  route TEXT, -- 'A_WITH_SOURCE', 'B_NO_SOURCE'
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_report_json JSONB,
  iteration_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(artifact_id, step_id)
);

CREATE INDEX idx_artifact_steps_artifact ON artifact_steps(artifact_id);
CREATE INDEX idx_artifact_steps_state ON artifact_steps(state);
```

### 7.3 Extender qa_sessions

```sql
ALTER TABLE qa_sessions ADD COLUMN step_id TEXT DEFAULT 'GO-ESP-01';
```

---

## Fase 8: Eventos de Pipeline

### 8.1 Tipos de eventos ESP-02

```typescript
type Esp02EventType =
  | 'ESP02_ROUTE_SELECTED'
  | 'ESP02_GENERATION_STARTED'
  | 'ESP02_GENERATION_COMPLETED'
  | 'ESP02_VALIDATION_RUN'
  | 'ESP02_VALIDATION_FAILED'
  | 'ESP02_SUBMITTED_TO_QA'
  | 'ESP02_QA_APPROVED'
  | 'ESP02_QA_REJECTED'
  | 'ESP02_ESCALATED'
  | 'ESP02_REGENERATION_STARTED'
```

---

## Fase 9: Flujo de Estados ESP-02

```
STEP_DRAFT
    │
    ▼ (seleccionar ruta + generar)
STEP_GENERATING
    │
    ▼ (generacion completa)
STEP_VALIDATING
    │
    ├─► (validacion OK) ─► STEP_READY_FOR_QA
    │                            │
    │                            ├─► (QA aprueba) ─► STEP_APPROVED
    │                            │
    │                            └─► (QA rechaza) ─► STEP_REJECTED
    │                                                    │
    │                                                    ▼
    │                                              (iterar < max)
    │                                                    │
    │                                                    ▼
    │                                            STEP_GENERATING
    │
    └─► (validacion falla + max iteraciones) ─► STEP_ESCALATED
```

---

## Fase 10: Orden de Implementacion

### Sprint 1: Foundation
1. [ ] Crear `src/domains/syllabus/` estructura
2. [ ] Definir tipos en `syllabus.types.ts`
3. [ ] Extender `database.types.ts` con campos ESP-02
4. [ ] Crear `syllabus.service.ts` con mocks

### Sprint 2: Validaciones
5. [ ] Implementar validadores V01-V05
6. [ ] Crear funcion `runAllValidations()`
7. [ ] Tests unitarios de validadores

### Sprint 3: Componentes UI
8. [ ] `SyllabusRouteSelector.tsx`
9. [ ] `SyllabusViewer.tsx`
10. [ ] `SyllabusGenerationForm.tsx`
11. [ ] `SyllabusQAView.tsx`

### Sprint 4: Integracion Paginas
12. [ ] Modificar `/artifacts/[id]` con tabs Paso 1/Paso 2
13. [ ] Modificar `/qa` con filtro por paso
14. [ ] Modificar `/qa/[id]` con vista ESP-02

### Sprint 5: Base de Datos (cuando conectes Supabase)
15. [ ] Migracion SQL para `artifact_steps`
16. [ ] Actualizar `qa_sessions` con `step_id`
17. [ ] Conectar servicios a Supabase

### Sprint 6: Polish
18. [ ] Eventos de pipeline
19. [ ] Manejo de errores
20. [ ] Estados de loading/progreso
21. [ ] Tests E2E

---

## Dependencias entre Fases

```
Fase 1 (Tipos) ─────────────────────────────────┐
                                                │
Fase 2 (Estructura) ────────────────────────────┤
                                                │
Fase 3 (Servicio) ──────► Fase 4 (Validadores) ─┼──► Fase 5 (UI)
                                                │         │
                                                │         ▼
                                                │    Fase 6 (Paginas)
                                                │         │
                                                ▼         ▼
                                           Fase 7 (DB) ──► Fase 8 (Eventos)
```

---

## Archivos a Crear/Modificar

### Nuevos archivos:
- `src/domains/syllabus/types/syllabus.types.ts`
- `src/domains/syllabus/services/syllabus.service.ts`
- `src/domains/syllabus/validators/syllabus.validators.ts`
- `src/domains/syllabus/hooks/useSyllabus.ts`
- `src/domains/syllabus/hooks/useSyllabusProgress.ts`
- `src/domains/syllabus/components/SyllabusViewer.tsx`
- `src/domains/syllabus/components/SyllabusRouteSelector.tsx`
- `src/domains/syllabus/components/SourceUploader.tsx`
- `src/domains/syllabus/components/SyllabusGenerationForm.tsx`
- `src/domains/syllabus/components/SyllabusQAView.tsx`
- `src/domains/syllabus/index.ts`
- `supabase/migrations/002_esp02_schema.sql`

### Archivos a modificar:
- `src/shared/types/database.types.ts`
- `src/domains/artifacts/services/artifacts.service.ts`
- `src/app/(dashboard)/artifacts/[id]/page.tsx`
- `src/app/(dashboard)/qa/page.tsx`
- `src/app/(dashboard)/qa/[id]/page.tsx`

---

## Notas Importantes

1. **Mock First**: Implementar todo con mocks antes de conectar Supabase
2. **Ruta B primero**: Es mas simple (sin upload de archivos)
3. **Validaciones estrictas**: Bloquear si no pasan V01-V05
4. **QA obligatorio**: Siempre requiere aprobacion humana
5. **Max 2 iteraciones**: Escalar si excede
