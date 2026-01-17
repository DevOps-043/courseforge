0) Contexto y objetivo

GO-ESP-02 transforma el output del Paso 1 (nombre + descripción + objetivos generales) en un temario estructurado:

Módulos: 1 por cada objetivo general

Lecciones por módulo: 3–6

Cada lección: objetivo específico medible/observable

2 rutas operativas:

Ruta A (con fuente primaria utilizable): iteración “sobre documentos”

Ruta B (sin fuente): IA como co-investigador/co-creador

El objetivo de este documento es definir modelo de datos, estados, validaciones, UI, servicios y pruebas para integrar el Paso 2 dentro de la arquitectura actual (Next.js/domains/Supabase/mocks). 

DOCUMENTACION_DESARROLLO

 

SOP´s - Guías operativas V1

1) Extracción de requisitos (del SOP)
Propósito

Generar Temario a partir del Paso 1, seleccionando Ruta A o Ruta B, con validación automática + aprobación QA. 

SOP´s - Guías operativas V1

Inputs (mínimos)

Comunes (todas):

course_name (del Paso 1)

descripcion (Paso 1)

objetivos_generales[] (Paso 1; 3–6)

Ruta A:

fuente_primaria[] (documentos: pdf/doc/ppt/texto; “utilizable”)

Ruta B:

idea_central (opcional si ya está en el artifact base; útil como contexto)

Outputs (DoD)

Lista de módulos (count == objetivos_generales count)

Cada módulo con 3–6 lecciones

Cada lección con objetivo específico medible

Evidencia de validación automática revisada (según ruta)

Registro guardado y listo como entrada del Paso 3 

SOP´s - Guías operativas V1

HITL (obligatorio)

QA/Coordinación:

Revisa coherencia global

Verifica derivación objetivos específicos ↔ objetivo general del módulo

Aprueba / regresa con observaciones 

SOP´s - Guías operativas V1

2) Decisiones de producto y OPEN_QUESTION (del SOP)

El SOP trae preguntas abiertas explícitas; aquí las marco + propongo defaults implementables:

OPEN_QUESTION 1 — “¿Dónde se registra la aprobación QA?”

Conflicto: el SOP pregunta el sistema exacto; tu app hoy tiene estado READY_FOR_QA y cola /qa. 

DOCUMENTACION_DESARROLLO

 

SOP´s - Guías operativas V1


Opción A (default recomendado): registrar aprobación en la tabla qa_sessions (o equivalente) con step_id='GO-ESP-02' + decision=APPROVED/REJECTED + review_notes.
Opción B: registrar aprobación como artifact_step.status = APPROVED y guardar un “snapshot” del temario aprobado.

Impacto: A habilita auditoría multi-step limpia y escalable.

OPEN_QUESTION 2 — “Criterio exacto de ‘fuente primaria utilizable’”

Opción A (default recomendado, validable): fuente utilizable si:

se puede subir/leer (sin password) y

supera un umbral mínimo de contenido extraíble: p.ej. >= 1,500 palabras o >= 8 páginas (configurable) y

cubre al menos k de los objetivos generales (chequeo semántico HITL o LLM).
Opción B: siempre permitir Ruta A si hay fuente, pero si la validación detecta “vacíos críticos”, migrar automáticamente a Ruta B (el SOP lo permite). 

SOP´s - Guías operativas V1

OPEN_QUESTION 3 — “Formato oficial de guardado del temario para Paso 3”

Opción A (default recomendado): guardar temario en DB como JSON estructurado + render UI; export opcional “copiar/pegar” a Coda.
Opción B: forzar guardado como tabla en Coda (pero hoy tu app no describe integración Coda aún).

3) Diseño de dominio y modelo de datos

Tu Artifact actual ya contiene campos del Paso 1. Para Paso 2 hay dos enfoques:

Enfoque recomendado: “Multi-step dentro de Artifact”

Mantener un Artifact por curso y agregar un subdocumento temario + metadatos de ruta/validación.

Extensión de tipos (TypeScript)
type Esp02Route = "A_WITH_SOURCE" | "B_NO_SOURCE";

interface SyllabusLesson {
  id: string;                 // uuid
  title: string;              // nombre corto de lección (opcional pero útil)
  objective_specific: string; // medible/observable
}

interface SyllabusModule {
  id: string;                    // uuid
  objective_general_ref: string;  // texto del objetivo general (o ID si lo normalizas)
  title: string;                 // nombre corto de módulo
  lessons: SyllabusLesson[];      // 3–6
}

interface TemarioEsp02 {
  route: Esp02Route;
  source_summary?: {
    files: Array<{ file_id: string; filename: string; mime: string }>;
    notes?: string;
    utilizable?: boolean;
  };
  modules: SyllabusModule[];
  validation: {
    automatic_pass: boolean;
    checks: Array<{ code: string; pass: boolean; message?: string }>;
    route_specific?: Array<{ code: string; pass: boolean; message?: string }>;
  };
  qa: {
    status: "PENDING" | "APPROVED" | "REJECTED";
    reviewed_by?: string;
    reviewed_at?: string;
    notes?: string;
  };
}

Cambios sugeridos en Artifact
interface Artifact {
  // ...existente
  temario?: TemarioEsp02;
  esp02_iteration_count?: number; // independiente si lo prefieres
}

4) Máquina de estados (app) aplicada a ESP-02

Tu app ya tiene:
DRAFT → GENERATING → VALIDATING → READY_FOR_QA → APPROVED/REJECTED/ESCALATED 

DOCUMENTACION_DESARROLLO

Para ESP-02, úsala por step, no solo global:

Propuesta: tabla/colección artifact_steps

Permite que el Artifact global siga existiendo, pero cada paso tenga estado y QA independiente.

Estados por step (GO-ESP-02):

STEP_DRAFT (aún sin ruta seleccionada)

STEP_GENERATING

STEP_VALIDATING

STEP_READY_FOR_QA

STEP_APPROVED

STEP_REJECTED

STEP_ESCALATED

Regla operativa (retrabajo/escalamiento):

Aunque el SOP de GO-ESP-02 no fija “2 iteraciones” explícitamente como el Paso 1, tu sistema puede estandarizar:

max_iterations = 2 antes de STEP_ESCALATED

y loguear evidencia (prompts, outputs, checks)

Nota: si quieres apegarte estrictamente al SOP, deja max_iterations como config por step (GO-ESP-02 = TBD) y márcalo como decisión pendiente.

5) Validaciones (automáticas vs HITL)
5.1 Validaciones mecánicas (100% automáticas)

V01: #modules == #objetivos_generales
V02: cada módulo tiene 3 <= #lessons <= 6
V03: cada lección tiene objective_specific no vacío y largo mínimo (p.ej. >= 12 caracteres)
V04: no duplicados obvios:

títulos de módulo repetidos

objetivos específicos idénticos (string match normalizado)
V05: estructura completa (sin huecos: módulo sin lecciones, lección sin objetivo)

5.2 Validaciones semánticas (preferible LLM + QA)

S01: “objetivo específico medible/observable” (evitar vagos: entender, conocer sin criterio) 

SOP´s - Guías operativas V1


S02: derivación: cada objetivo específico se justifica desde el objetivo general del módulo 

SOP´s - Guías operativas V1


S03: coherencia de secuencia didáctica (especialmente Ruta B) 

SOP´s - Guías operativas V1

Implementación práctica:

Automático: heurísticas + “clasificador LLM” que devuelve PASS/FAIL con razones.

HITL: QA confirma / corrige.

6) Contrato de generación (prompts) — salida parseable
6.1 Output estándar (JSON “canónico”)

Esto es clave para automatizar validaciones:

{
  "route": "A_WITH_SOURCE",
  "modules": [
    {
      "title": "Módulo 1: ...",
      "objective_general_ref": "Objetivo general exacto del Paso 1",
      "lessons": [
        { "title": "Lección 1.1 ...", "objective_specific": "Verbo + criterio observable..." }
      ]
    }
  ]
}

6.2 Prompt plantilla (Ruta B)

Input: nombre + descripción + objetivos generales

Output: JSON anterior

Reglas: 1 módulo por objetivo general; 3–6 lecciones; objetivos específicos medibles; progresión de complejidad.

6.3 Prompt plantilla (Ruta A)

Input: lo mismo + “resumen/extracto” de fuente (cuando exista extracción) o chunks

Output: JSON

Regla: si detecta cobertura insuficiente → marcar route_recommendation="B_NO_SOURCE" y razones (para migración a Ruta B, como SOP permite). 

SOP´s - Guías operativas V1

7) UI/UX: pantallas y flujo

Basado en tus rutas actuales (/generate, /artifacts/[id], /qa/[id]). 

DOCUMENTACION_DESARROLLO

7.1 /artifacts/[id] (detalle)

Agregar sección nueva: Paso 2 — Temario

Selector de ruta:

( ) Ruta A — con fuente

( ) Ruta B — sin fuente

Si Ruta A: componente de upload (aunque sea mock inicialmente)

Botón: “Generar temario”

Componente: PipelineProgress mostrando estados del step

Vista del temario (módulos/lessons) y reportes de validación

7.2 /qa/[id] (revisión)

Agregar “modo step”:

selector: Paso 1 / Paso 2 / Paso 3...

para Paso 2:

checklist visible (V01–V05 + S01–S03)

botones: Approve / Reject

campo obligatorio: observaciones si Reject

8) Servicios (domains) y estructura sugerida
Nuevo dominio sugerido

Crear domains/syllabus/ o extender domains/generation/ con step2.

Recomendación: domains/syllabus/ para separar “temario” de “generación” genérica.

Estructura:

domains/syllabus/
  components/
    SyllabusViewer.tsx
    SyllabusRouteSelector.tsx
    SourceUploader.tsx
  hooks/
    useSyllabus.ts
  services/
    syllabus.service.ts
  types/
    syllabus.types.ts
  index.ts

syllabus.service.ts (mock primero)

Funciones mínimas:

startEsp02Generation(artifactId, route, sourceFiles?)

validateEsp02(artifactId)

submitEsp02ToQa(artifactId)

applyQaDecisionEsp02(artifactId, decision, notes)

9) Base de datos (Supabase) — diseño mínimo

Tu documentación lista tablas genéricas (artifacts, qa_sessions, pipeline_events, user_roles) pero no detalla columnas. 

DOCUMENTACION_DESARROLLO

Tabla recomendada: artifact_steps

Campos mínimos:

id (uuid)

artifact_id (fk)

step_id (GO-ESP-01, GO-ESP-02, …)

state (enum)

route (nullable)

payload_json (jsonb) — aquí vive el TemarioEsp02 o “output canónico”

validation_report_json (jsonb)

iteration_count (int)

created_at, updated_at

Tabla qa_sessions (si ya existe)

Agregar:

artifact_step_id (fk)

decision (APPROVED/REJECTED)

notes

reviewed_by

reviewed_at

10) Auditoría y trazabilidad (mínimo)

Guardar en pipeline_events (o log equivalente):

artifact_id

step_id

event_type: GEN_STARTED, GEN_OUTPUT, VALIDATION_RUN, QA_SUBMITTED, QA_DECISION, ESCALATED

payload: prompt hash, route, resumen de checks, etc.

Esto te permite reproducir fallos y entrenar mejoras.

11) Suite de pruebas (Given/When/Then)
Happy path — Ruta B

Dado artifact con Paso 1 completo

Cuando selecciono Ruta B y genero

Entonces se generan módulos = # objetivos generales

Y cada módulo tiene 3–6 lecciones

Y pasa validación automática

Y queda STEP_READY_FOR_QA

Y QA aprueba → STEP_APPROVED

Happy path — Ruta A

Dado artifact con Paso 1 completo y fuentes cargadas

Cuando genero Ruta A

Entonces output cumple estructura y validaciones

Y QA aprueba

Edge — Ruta A fuente insuficiente (migración)

Dado Ruta A con fuente que no cubre

Cuando la validación/LLM detecta vacíos críticos

Entonces el sistema recomienda/cambia a Ruta B y registra evento

Y no marca como aprobado hasta re-generar con Ruta B

Edge — fuera de rango de lecciones

Dado output con módulo de 2 lecciones

Cuando corre validación

Entonces automatic_pass=false y STEP_VALIDATING → STEP_ESCALATED si excede iteraciones

Edge — QA rechaza

Dado temario en QA

Cuando QA rechaza con notas

Entonces step pasa a STEP_REJECTED

Y operador puede re-generar (itera) y re-enviar

12) Especificación implementable (YAML)
step_id: GO-ESP-02
name: "Generación del temario"
start_conditions:
  - "Paso 1 completo: nombre + descripción + objetivos_generales[3..6]"
  - "Ruta seleccionada: A_WITH_SOURCE o B_NO_SOURCE"
end_conditions:
  - "modules.count == objetivos_generales.count"
  - "cada módulo lessons.count in [3..6]"
  - "cada lección tiene objective_specific medible (HITL/LLM)"
  - "validación automática ejecutada y registrada"
  - "QA aprobado y registrado"
inputs:
  - key: artifact_id
    type: uuid
    required: true
  - key: route
    type: enum
    values: [A_WITH_SOURCE, B_NO_SOURCE]
    required: true
  - key: paso1_snapshot
    type: object
    required: true
  - key: source_files
    type: array
    required: false
outputs:
  - key: temario_json
    type: json
  - key: validation_report
    type: json
  - key: qa_decision
    type: enum
    values: [PENDING, APPROVED, REJECTED]
validations:
  - code: V01_MODULES_MATCH_OBJECTIVES
    severity: error
    rule: "modules.count == objetivos_generales.count"
    message: "El número de módulos debe ser igual al número de objetivos generales."
  - code: V02_LESSONS_RANGE
    severity: error
    rule: "forall module: 3 <= module.lessons.count <= 6"
    message: "Cada módulo debe tener entre 3 y 6 lecciones."
  - code: V03_OBJECTIVES_PRESENT
    severity: error
    rule: "forall lesson: len(trim(lesson.objective_specific)) > 0"
    message: "Cada lección debe incluir objetivo específico."
roles_hitl:
  operator:
    can: [select_route, start_generation, request_correction, submit_to_qa]
  qa:
    can: [approve, reject]
escalation_policy:
  max_iterations: 2
  on_exceed: STEP_ESCALATED
audit_log_fields:
  - artifact_id
  - step_id
  - route
  - iteration_count
  - validation_summary
  - qa_decision
  - reviewed_by
  - timestamps

13) Checklist de implementación (para tu repo)

Tipos

 syllabus.types.ts + extender artifact.types.ts

Persistencia

 Migración SQL artifact_steps (recomendado) o artifacts.temario_json

Servicios

 syllabus.service.ts con mock + eventos pipeline

UI

 Route selector + uploader (Ruta A)

 Viewer del temario

 QA view para Paso 2

Validación

 Motor de checks V01–V05 (Zod + funciones puras)

 Stubs para “semantic checks” (S01–S03)

QA

 Persistir decisión + notas + quién/cuándo