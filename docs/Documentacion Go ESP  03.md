Documento técnico — Integración GO-ESP-03 (Paso 3) en la app

GO-ESP-03 — Paso 3: Fase 1 (Plan instruccional) — Enfoque HITL/DoD

0) Contexto y objetivo

GO-ESP-03 toma el Temario final (Paso 2) y genera un Plan instruccional por lección (matriz/plan), con controles humanos obligatorios (HITL) para asegurar:

Completitud (todas las lecciones están cubiertas).

Alineación OA ↔ contenido (lo planeado cumple lo que exige el Objetivo de Aprendizaje).

Componentes obligatorios por lección: Diálogo + Lectura + Quiz (al menos planificados).

Detección y registro de incumplimientos / bloqueadores.

Salidas válidas (fin del paso):

“Aprobado Fase 1” (plan listo), o

“Con bloqueadores” (bloqueadores enumerados con impacto + responsable asignado).

1) Extracción de requisitos (del SOP)
Propósito

Generar y validar el Plan instruccional por lección a partir del temario final, con evidencias DoD y control HITL.

Inputs (mínimos)

artifact_id

temario_final (desde GO-ESP-02): módulos, lecciones, objetivo específico por lección

coda_doc_ref (link/ID del documento del curso/taller) (fuente de verdad operativa según SOP)

Config de step:

max_iterations = 2 (regla dura)

Outputs (DoD)

plan_instruccional por lección (estructura consistente y completa)

dod_evidence:

checklist DoD (A–D)

comentarios/hallazgos por lección o por hallazgo

tabla de bloqueadores y riesgos (o “Sin bloqueadores”)

estado_final:

APPROVED_PHASE_1 o WITH_BLOCKERS

iteration_count registrado

Roles / HITL

Operador (humano)

Ejecuta prompt (copy/paste), genera borradores con IA

Corre controles HITL (estructura, OA↔contenido, componentes obligatorios, bloqueadores)

Itera con IA (máximo 2 iteraciones dirigidas)

Registra versiones y evidencias en Coda

Escala cuando aplique

Arquitecto del curso (humano) — aprobador final

Revisa evidencias DoD y decide:

“Aprobado Fase 1” o

“Con bloqueadores”

Desbloquea decisiones cuando no sea corregible dentro del límite de iteraciones

2) Reglas duras (DoD / límites / naming)
Reglas de iteración (hard rule)

Máximo 2 iteraciones dirigidas (por ciclo de Paso 3).

Si tras iteración 2 persisten incumplimientos/bloqueadores → escalar a Arquitecto del curso.

Reglas HITL obligatorias (controles)

Estructura: salida incluye todas las lecciones del temario (sin omisiones, sin “resumen”).

Alineación OA↔contenido: coherencia entre OA y lo planeado (si OA exige práctica/aplicación → debe existir demo/guía o equivalente).

Componentes obligatorios: cada lección contempla (al menos planificado):

Diálogo

Lectura

Quiz

Bloqueadores/riesgos: registrar lo que impida producir materiales o videos (OA ambiguo/no medible, falta de demo/guía cuando corresponde, falta de componente obligatorio, contradicciones internas, etc.).

Evidencias mínimas (DoD A–D)

A) Completitud: todas las lecciones + OA operable
B) Calidad instruccional mínima: OA (Bloom + criterio medible), coherencia OA↔componentes, sin contradicciones
C) Componentes obligatorios: diálogo + lectura + quiz planificados
D) Bloqueadores/riesgos: si hay, enumerados con impacto + responsable; si no hay, “Sin bloqueadores”

3) OPEN_QUESTION (necesarias para implementación)

El SOP indica “matriz/plan” pero no define el schema exacto del plan.

OPEN_QUESTION 1 — ¿Cuál es la “plantilla oficial” del plan instruccional (campos)?

Opción A (default recomendado): definir un JSON canónico (abajo) y renderizarlo en UI + export a Coda.

Opción B: almacenar plan como “texto libre” + checklist estructurada (más rápido, menos automatizable).

Impacto: A habilita validación mecánica fuerte y QA asistido; B reduce desarrollo pero dificulta automatización.

OPEN_QUESTION 2 — ¿GO-ESP-04 puede iniciar si el estado es “Con bloqueadores”?

Opción A (estricto): bloquear avance; requiere APPROVED_PHASE_1.

Opción B (flexible): permitir avance con bandera de riesgo, pero registrar bloqueo para producción.

Impacto: define el gating del pipeline.

4) Modelo de datos (recomendado)
Output canónico (TypeScript)
type Esp03FinalStatus = "APPROVED_PHASE_1" | "WITH_BLOCKERS";
type PlanComponentType = "DIALOGUE" | "READING" | "QUIZ" | "DEMO_GUIDE" | "EXERCISE" | "RESOURCE";

interface PlanComponent {
  type: PlanComponentType;
  summary: string;           // descripción breve de lo planeado
  notes?: string;
}

interface LessonPlan {
  lesson_id: string;         // referencia a temario
  lesson_title: string;
  oa_text: string;           // OA/objetivo específico (debe ser operable)
  oa_bloom_verb?: string;    // opcional (si extraes)
  measurable_criteria?: string; // opcional (si extraes)
  components: PlanComponent[];   // debe incluir DIALOGUE, READING, QUIZ
  alignment_notes?: string;      // notas HITL/LLM sobre OA↔contenido
}

interface Blocker {
  id: string;                // uuid
  lesson_id?: string;        // si aplica a una lección
  title: string;
  description: string;
  impact: "LOW" | "MEDIUM" | "HIGH";
  owner: string;             // responsable asignado (texto)
  status: "OPEN" | "RESOLVED" | "WONT_FIX";
}

interface Esp03PlanPayload {
  source: { temario_version_id?: string; coda_doc_ref?: string };
  lesson_plans: LessonPlan[];
  blockers: Blocker[];
  dod: {
    checklist: Array<{ code: "DOD_A"|"DOD_B"|"DOD_C"|"DOD_D"; pass: boolean; evidence?: string; notes?: string }>;
    automatic_checks: Array<{ code: string; pass: boolean; message?: string }>;
  };
  iteration_count: number;
  final_status: Esp03FinalStatus; // decidido por Arquitecto del curso
  approvals: {
    architect_status: "PENDING" | "APPROVED" | "REJECTED";
    reviewed_by?: string;
    reviewed_at?: string;
    notes?: string;
  };
}

Persistencia recomendada (Supabase)

Mantén el patrón “por step” con artifact_steps:

artifact_id

step_id = GO-ESP-03

state (ver state machine)

payload_json (Esp03PlanPayload)

iteration_count

validation_report_json

created_at, updated_at

5) Máquina de estados (GO-ESP-03)
Estados por step

STEP_DRAFT (sin plan aún)

STEP_GENERATING

STEP_VALIDATING

STEP_READY_FOR_REVIEW (equivalente a QA, pero rol = Arquitecto)

STEP_APPROVED (final_status = APPROVED_PHASE_1)

STEP_WITH_BLOCKERS (final_status = WITH_BLOCKERS)

STEP_ESCALATED

Transiciones clave

STEP_GENERATING → STEP_VALIDATING (checks automáticos)

STEP_VALIDATING → STEP_READY_FOR_REVIEW (si no hay fallas estructurales)

STEP_READY_FOR_REVIEW → STEP_APPROVED | STEP_WITH_BLOCKERS

Si iteration_count >= 2 y siguen fallas → STEP_ESCALATED

6) Validaciones (automáticas vs HITL)
6.1 Validaciones mecánicas (automáticas)

V01: lesson_plans.count == temario.lessons.count
V02: cada LessonPlan tiene oa_text no vacío
V03: cada lección incluye componentes obligatorios:

DIALOGUE, READING, QUIZ presentes en components[]
V04: si blockers[] vacío, debe existir evidencia “Sin bloqueadores” en DoD_D (o flag equivalente)
V05: iteration_count <= 2 (si excede, force STEP_ESCALATED)

6.2 Validaciones semánticas (LLM + HITL)

S01: OA operable = verbo (Bloom) + criterio medible
S02: OA↔componentes coherente (si OA implica práctica → DEMO_GUIDE o equivalente)
S03: sin contradicciones internas (OA avanzado vs contenido introductorio)

Recomendación: implementar S01–S03 como “LLM-assisted checks” que devuelven PASS/FAIL + reasons, pero la decisión final queda en el Arquitecto.

7) Contrato de prompts (salida parseable)
7.1 Output estándar (JSON canónico)
{
  "lesson_plans": [
    {
      "lesson_id": "L1",
      "lesson_title": "Lección 1",
      "oa_text": "…",
      "components": [
        { "type": "DIALOGUE", "summary": "…" },
        { "type": "READING", "summary": "…" },
        { "type": "QUIZ", "summary": "…" },
        { "type": "DEMO_GUIDE", "summary": "…", "notes": "si aplica" }
      ]
    }
  ],
  "blockers": []
}

7.2 Prompt plantilla (generación)

Inputs:

temario completo (módulos/lecciones/OA por lección)

reglas: incluir todas las lecciones; componentes obligatorios; coherencia OA↔plan

Output:

JSON canónico anterior, sin texto adicional

7.3 Prompt plantilla (iteración dirigida)

Inputs:

lección(es) específicas + qué incumple (ej. “OA no medible”, “falta demo/guía”, “falta quiz”)
Output:

JSON parcial (solo lecciones afectadas) o JSON completo (según decisión de diseño)

8) UI/UX (mínimo viable)
/artifacts/[id] — Sección “Paso 3 — Plan instruccional”

Botón: Generar plan (IA)

Viewer por módulo/lección:

OA

Componentes (chips: diálogo/lectura/quiz/demo/guía…)

Panel “Validación” (V01–V05 + S01–S03)

Panel “Bloqueadores y riesgos”

crear/editar blockers con impact + owner

/review/[id] o reutilizar /qa/[id] (recomendado)

Selector de step: Paso 1 / Paso 2 / Paso 3

Para Paso 3:

checklist DoD A–D

decisión del Arquitecto:

Aprobar Fase 1

Marcar Con bloqueadores

notas obligatorias si “Con bloqueadores”

Nota: aunque tu app tenga “QA”, en este paso el rol operativo es Arquitecto del curso. En permisos, mapea “QA reviewer” → “Architect reviewer” para GO-ESP-03.

9) Servicios (domain) sugeridos

Nuevo dominio recomendado: domains/instructionalPlan/

domains/instructionalPlan/
  services/instructionalPlan.service.ts
  validators/instructionalPlan.validators.ts
  types/instructionalPlan.types.ts
  components/InstructionalPlanViewer.tsx
  components/BlockersPanel.tsx


Funciones mínimas:

startEsp03Generation(artifactId)

validateEsp03(artifactId) (V01–V05 + stub S-checks)

submitEsp03ForArchitectReview(artifactId)

applyArchitectDecisionEsp03(artifactId, decision, notes, blockers?)

escalateEsp03(artifactId, reason)

10) Auditoría / trazabilidad (pipeline_events)

Registrar al menos:

GEN_STARTED, GEN_OUTPUT_SAVED

VALIDATION_RUN, VALIDATION_FAILED

ITERATION_REQUESTED, ITERATION_APPLIED

REVIEW_SUBMITTED, ARCHITECT_DECISION

ESCALATED

Campos sugeridos:

artifact_id, step_id, iteration_count

checks_summary

blockers_count

reviewed_by, reviewed_at

11) Suite de pruebas (Given/When/Then)
Happy path — Aprobado Fase 1

Dado temario final aprobado (Paso 2)

Cuando genero plan

Entonces V01–V03 pasan

Y se envía a revisión

Y Arquitecto aprueba → STEP_APPROVED + final_status=APPROVED_PHASE_1

Happy path — Con bloqueadores

Dado plan generado

Cuando Arquitecto marca “Con bloqueadores” y llena blockers con impacto+responsable

Entonces STEP_WITH_BLOCKERS + DoD_D evidencia presente

Edge — Falta componente obligatorio

Dado una lección sin QUIZ

Cuando corre validateEsp03

Entonces falla V03 y bloquea submit a revisión hasta corrección/iteración

Edge — Exceso de iteraciones

Dado iteration_count=2 y persisten fallas

Cuando se intenta otra iteración

Entonces STEP_ESCALATED y se exige revisión del Arquitecto

12) Especificación implementable (YAML)
step_id: GO-ESP-03
name: "Plan instruccional por lección (Fase 1)"
start_conditions:
  - "Temario final disponible (GO-ESP-02)"
end_conditions:
  - "Estado final en {APPROVED_PHASE_1, WITH_BLOCKERS}"
  - "Evidencia DoD A–D registrada"
inputs:
  - key: artifact_id
    type: uuid
    required: true
  - key: temario_final
    type: object
    required: true
outputs:
  - key: plan_instruccional_json
    type: json
  - key: blockers
    type: json
  - key: dod_evidence
    type: json
  - key: final_status
    type: enum
    values: [APPROVED_PHASE_1, WITH_BLOCKERS]
validations:
  - code: V01_ALL_LESSONS_PRESENT
    severity: error
    rule: "lesson_plans.count == temario.lessons.count"
    message: "El plan debe incluir todas las lecciones del temario."
  - code: V03_REQUIRED_COMPONENTS
    severity: error
    rule: "forall lesson: has(DIALOGUE) && has(READING) && has(QUIZ)"
    message: "Cada lección debe incluir Diálogo, Lectura y Quiz (planificados)."
  - code: V05_MAX_ITERATIONS
    severity: error
    rule: "iteration_count <= 2"
    message: "Se excedió el máximo de 2 iteraciones. Escalar."
roles_hitl:
  operator:
    can: [generate, iterate, register_evidence, submit_for_review]
  architect:
    can: [approve_phase_1, mark_with_blockers, escalate]
escalation_policy:
  max_iterations: 2
  on_exceed: STEP_ESCALATED
audit_log_fields:
  - artifact_id
  - step_id
  - iteration_count
  - checks_summary
  - blockers_summary
  - final_status
  - reviewed_by
  - timestamps

13) Checklist de implementación (en tu repo)

 Definir instructionalPlan.types.ts (schema canónico)

 Implementar validadores V01–V05 (Zod + funciones puras)

 Agregar servicios instructionalPlan.service.ts (mock primero)

 UI: viewer por lección + panel de bloqueadores + checklist DoD

 Review UI: decisión Arquitecto (Aprobado Fase 1 / Con bloqueadores)

 Persistencia en artifact_steps + eventos en pipeline_events