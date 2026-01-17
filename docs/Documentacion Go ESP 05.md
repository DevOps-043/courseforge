1) Propósito del módulo (qué debe lograr el sistema)

Implementar el flujo de Fase 3 (Materiales) dentro del pipeline del curso:

Input: Plan del Paso 3 (OA + componentes esperados + requisitos del quiz) + Fuentes curadas del Paso 4 (con bitácora).

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

Proceso: Generar materiales por lección y correr controles (auto + HITL).

Output: Materiales por lección con estado “Aprobado Fase 3” o “Con bloqueadores/correcciones”, y luego consolidación para QA/Coordinación. 

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

2) Alcance (Start/End conditions)

Start (precondiciones duras)

Existe Plan (Paso 3) accesible. 

SOP´s - Guías operativas V1

Existe Curaduría (Paso 4) accesible: fuentes curadas + bitácora. 

SOP´s - Guías operativas V1

End (resultados válidos)

Materiales completos por lección con estado Aprobado Fase 3, o

Materiales con estado Con bloqueadores/correcciones documentados. 

SOP´s - Guías operativas V1

Regla de bloqueo recomendada (para evitar tu error de links rotos): si el Paso 4 entrega fuentes “curadas” pero con URLs inaccesibles para componentes críticos, Paso 5 no debe correr: debe “rebotar” a Paso 4 con lista de URLs fallidas (esto es coherente con “no se apoya en fuentes NO aptas” y trazabilidad).

SOP´s - Guías operativas V1

3) Roles / HITL (quién hace qué)

Operador (Humano)

Ejecuta prompt, genera materiales por lección.

Corre controles HITL/DoD y hace iteración dirigida.

Empaqueta y registra bitácora/estado. 

SOP´s - Guías operativas V1

QA/Coordinación (Humano)

Revisa entrega consolidada de Fase 3.

Aprueba para producción o devuelve con observaciones; operador corrige y reenvía. 

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

4) Controles DoD (qué valida el sistema)
4.1 Controles automáticos (bloquean avance si fallan)

Basados en los “Controles 3–6” del SOP:

Control 3 — Consistencia con el plan (Paso 3):

OA (verbo + criterio) reflejado en guion/lectura/actividad/quiz.

Si el plan exige demo/guía: existe y es ejecutable.

No hay componentes inventados desconectados del plan. 

SOP´s - Guías operativas V1

Control 4 — Uso correcto de fuentes (Paso 4):

Afirmaciones clave y ejemplos respaldados por fuentes curadas (o marcado explícito si falta).

No usar fuentes NO aptas. 

SOP´s - Guías operativas V1

Control 5 — Evaluación (Quiz):

Cantidad/tipo/dificultad/cobertura según Paso 3 (no estándar fijo).

Retroalimentación según estándar del proyecto (definido en prompt vigente). 

SOP´s - Guías operativas V1

Nota: parte de “afirmaciones clave” es difícil de automatizar perfecto; se recomienda heurística + HITL (ver 4.2 y OPEN_QUESTION).

4.2 Controles HITL (UI de checklist + aprobación)

Verificar alineación pedagógica (OA ↔ contenido) en una vista por lección.

Confirmar “producible”: si el plan pide demo/guía, que tenga pasos y recursos realizables. 

SOP´s - Guías operativas V1

4.3 Iteración dirigida (solo lo que incumple)

El SOP explícitamente pide re-pedir únicamente lo fallido con instrucción específica. 

SOP´s - Guías operativas V1

✅ En app: “Fix mode” debe generar un prompt incremental tipo:

“Reescribe el quiz de la lección X conforme al Paso 3: N preguntas…”

“Ajusta storyboard para que sea producible…”

SOP´s - Guías operativas V1

4.4 Bloqueadores

Detectar bloqueadores (algo impide producir/cerrar Fase 3). Registrar qué es, impacto, responsable, estado. 

SOP´s - Guías operativas V1

5) Empaquetado + QA final

Empaquetado por lección: guardar cada componente final; aplicar naming/versionado/estructura según prompt vigente; registrar bitácora y estado por lección. 

SOP´s - Guías operativas V1

QA final: consolidar entrega de todas las lecciones, QA decide (Aprobado Fase 3 → producción / No aprobado → observaciones); operador corrige y reenvía hasta cierre. 

SOP´s - Guías operativas V1

6) Especificación implementable (modelo + estados + validaciones)
6.1 State machine (Fase 3)

Reutiliza el patrón de estados del sistema actual (DRAFT → GENERATING → VALIDATING → READY_FOR_QA → APPROVED…), pero aplicado a “Phase3Materials”. 

DOCUMENTACION_DESARROLLO

Propuesta (por curso, con subestado por lección):

PHASE3_DRAFT

PHASE3_GENERATING

PHASE3_VALIDATING

PHASE3_NEEDS_FIX (iteración dirigida)

PHASE3_READY_FOR_QA (consolidado)

PHASE3_APPROVED

PHASE3_REJECTED

PHASE3_ESCALATED (bloqueadores no resolubles)

Transiciones clave:

VALIDATING → NEEDS_FIX si falla Control 3/4/5

VALIDATING → READY_FOR_QA si cumple DoD por lección y no hay bloqueadores

READY_FOR_QA → APPROVED/REJECTED por QA

6.2 Data model (mínimo necesario)

Tu Artifact actual modela Paso 1. Para SOP 5 necesitas agregar estructura de materiales.

Nuevas entidades (recomendado):

phase3_lessons (1 row por lección)

phase3_components (1 row por componente generado: DIALOGUE, READING, QUIZ, EXERCISE, DEMO_GUIDE, etc.)

phase3_validations (resultados de controles por lección/componente)

phase3_packages (rutas/naming/version explainable)

Campos clave por componente:

content (JSON / markdown)

source_refs[] (ids a fuentes curadas Paso 4)

status (PASS/FAIL/PENDING)

attempt (iteración dirigida)

6.3 JSON Contract (API / LLM boundary)
{
  "step_id": "GO-ESP-05",
  "course_id": "uuid",
  "inputs": {
    "plan_v1": {
      "lessons": [
        {
          "lesson_id": "string",
          "module": "string",
          "title": "string",
          "oa": { "verb": "string", "criterion": "string" },
          "expected_components": ["DIALOGUE","READING","QUIZ","EXERCISE"],
          "quiz_spec": { "num_items": 10, "types": ["MCQ"], "difficulty": "mixed" },
          "requires_demo_guide": true
        }
      ]
    },
    "curated_sources_v1": [
      {
        "source_id": "string",
        "lesson_id": "string",
        "component": "READING",
        "title": "string",
        "url": "string",
        "apta": true,
        "http_status": 200,
        "critical": true,
        "verified_at": "ISO-8601"
      }
    ],
    "prompt_version": "Prompt 3/3 + Maestro v2.4"
  },
  "outputs": {
    "lessons": [
      {
        "lesson_id": "string",
        "components": {
          "DIALOGUE": { "content": "string", "source_refs": ["source_id"] },
          "READING": { "content": "string", "source_refs": ["source_id"] },
          "QUIZ": {
            "items": [
              {
                "q": "string",
                "options": ["A","B","C","D"],
                "answer": "B",
                "feedback_by_option": { "A": "string", "B": "string", "C": "string", "D": "string" }
              }
            ],
            "source_refs": ["source_id"]
          }
        },
        "dod": {
          "control3_plan_consistency": "PASS|FAIL",
          "control4_sources_usage": "PASS|FAIL",
          "control5_quiz_spec": "PASS|FAIL",
          "blockers": []
        },
        "state": "APPROVABLE_PHASE3|NEEDS_FIX|BLOCKED"
      }
    ],
    "package": {
      "naming_convention_version": "string",
      "files": [{"path":"string","hash":"string","component":"string","lesson_id":"string"}]
    }
  }
}

7) Validations (tabla regla → cómo validar → acción)
Regla	Tipo	Cómo se valida	Acción si falla
Cada lección tiene todos los componentes del plan	Auto	comparar expected_components vs components	bloquear + iteración dirigida
Si plan exige demo/guía, debe existir	Auto/HITL	flag requires_demo_guide y presencia DEMO_GUIDE + checklist “ejecutable”	NEEDS_FIX
No inventar componentes fuera del plan	Auto	diff inverse (componentes generados no esperados)	NEEDS_FIX
No usar fuentes NO aptas	Auto	join con curated_sources (apta=false)	bloquear + NEEDS_FIX
“Afirmaciones clave” respaldadas o marcadas	HITL + heurística	UI checklist + (opcional) detector de “claims” por regex	NEEDS_FIX
Quiz cumple spec del Paso 3	Auto	num_items/type/difficulty/cobertura	NEEDS_FIX
Feedback por opción en quiz (si estándar lo exige)	Auto	presencia de feedback_by_option	NEEDS_FIX

Los criterios de Control 3/4/5 salen del SOP. 

SOP´s - Guías operativas V1

8) Integración en UI (Next.js)

Basado en tus rutas existentes (/artifacts/:id, /qa/:id).

DOCUMENTACION_DESARROLLO

Añadir en detalle del artefacto: pestaña “Paso 5: Materiales” con:

Vista por módulo → lección (accordion)

Para cada lección:

plan snapshot (OA + expected components + quiz spec)

cards por componente generado

panel de validación (Control 3/4/5 + blockers)

botón “Iteración dirigida” (solo fallas)

estado por lección: APPROVABLE_PHASE3 / NEEDS_FIX / BLOCKED

Botón “Consolidar entrega Fase 3 → QA” (habilitado solo si todas las lecciones están “approvable” o con bloqueadores aceptados)

QA view:

QA ve entrega consolidada

decide: APPROVED / REJECTED con comentarios

operador reabre en NEEDS_FIX y reenvía (ciclo)

SOP´s - Guías operativas V1

9) Registros y audit log (trazabilidad)

Mínimo por evento:

course_id, step_id=GO-ESP-05, lesson_id, component, attempt, user_id, timestamp

prompt_version, model, input_hash, output_hash

validation_results (Control 3/4/5 + blockers)

package_paths (naming/versionado aplicado)

Esto soporta lo que el SOP llama “bitácora y estado DoD” + empaquetado. 

SOP´s - Guías operativas V1

10) Suite de pruebas (Given/When/Then)

Happy path

Dado plan + fuentes aptas accesibles

Cuando se genera por lección

Entonces todos los controles PASS y se puede consolidar a QA

URLs rotas (tu caso)

Dado fuentes “curadas” con 404/403/timeout

Cuando inicia Paso 5

Entonces el sistema bloquea y devuelve a Paso 4 con lista de URLs fallidas (no permite “marcar apta”)

Plan exige demo/guía y falta

Cuando valida Control 3

Entonces NEEDS_FIX con prompt incremental específico

Quiz mismatch

Dado quiz_spec num_items=10

Cuando genera 7 preguntas

Entonces falla Control 5 y genera instrucción de retrabajo exacta

Uso de fuente NO apta

Cuando componente referencia source_id con apta=false

Entonces bloqueo inmediato y retrabajo

Bloqueadores

Cuando tras iteraciones sigue faltando algo no corregible

Entonces estado BLOCKED y registro de bloqueador con responsable/impacto

SOP´s - Guías operativas V1

11) OPEN_QUESTION (pendientes que conviene decidir ya)

Límite de iteraciones en SOP 5
El SOP dice “repetir controles aplicables hasta cumplir DoD” pero no fija un número aquí. 

SOP´s - Guías operativas V1


Propuesta default: mantener coherencia con el sistema y usar max_iterations=2 por lección/componente (como regla global del pipeline). Impacto: evita loops y hace escalamiento determinista.

Definición operativa de “afirmaciones clave”
Propuesta: checklist HITL + heurística (párrafos con “por lo tanto”, “la evidencia”, “según”, números/estadísticas) y exigir source_ref en esos bloques.

Naming/versionado “según prompt vigente”
El SOP delega el estándar al prompt vigente. 

SOP´s - Guías operativas V1


Propuesta: llevarlo a config (naming_convention_version) y validarlo con regexs.