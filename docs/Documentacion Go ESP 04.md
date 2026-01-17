Documento técnico de integración — SOP GO-ESP-04 (Paso 4 / Fase 2)
1) Propósito del módulo (qué “habilita” en el sistema)

Implementar un sub-flujo de pipeline que tome como input el Plan instruccional del Paso 3 (matriz por lección) y produzca como outputs:

Tabla final “Lección → Componente → Fuentes” con columnas DoD (aptitud, cobertura, crítico, etc.).

SOP´s - Guías operativas V1

Bitácora completa (formato estandarizado del Prompt 2/3).

SOP´s - Guías operativas V1

Bloqueadores si tras 2 intentos algún componente requerido queda sin fuente apta con cobertura completa.

SOP´s - Guías operativas V1

Y luego enviar a QA para dictamen XOR:

Aprobado Fase 2

Corregible

Con bloqueadores

SOP´s - Guías operativas V1

2) Inputs / Outputs (contratos de datos)
2.1 Input obligatorio (desde Paso 3)

instructional_plan (idealmente JSON, mínimo texto estructurado) con:

lessons[]

lesson_id / lesson_title

components_required[] (e.g., Diálogo, Lectura, Quiz, Demo/Guía…)

is_critical por componente (viene “siempre marcado” según SOP).

SOP´s - Guías operativas V1

Regla dura: sin Paso 3 disponible, no inicia Paso 4.

SOP´s - Guías operativas V1

2.2 Output principal (persistido)

Tabla “Lección → Componente → Fuentes” con columnas sugeridas por el SOP (si tu sistema ya tiene columnas, usar exactamente esas):

lesson

component

critical (Sí/No)

source_ref (título/URL/ref)

apta (Sí/No)

motivo_no_apta (si aplica)

cobertura_completa (Sí/No)

SOP´s - Guías operativas V1

2.3 Outputs secundarios

Bitácora por intento (Intento 1 e Intento 2 si aplica).

SOP´s - Guías operativas V1

Bloqueadores: lista de componentes sin fuente apta+cobertura tras 2 intentos.

SOP´s - Guías operativas V1

3) Reglas duras (DoD + límites)
3.1 Límite de iteraciones (anti-loop)

Máximo 2 intentos totales:

Intento 1 = ejecución inicial (Prompt 2/3)

Intento 2 = 1 iteración dirigida si faltan fuentes aptas/cobertura completa
Si después del Intento 2 persiste brecha ⇒ bloqueador.

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

3.2 DoD mínimo automatizable (lo que el sistema debe validar)

A) Cobertura por lección

Cada componente requerido tiene ≥1 fuente Apta con Cobertura completa.

Componentes críticos requieren cobertura completa explícita.

SOP´s - Guías operativas V1

B) Operabilidad

Fuentes problemáticas marcadas NO APTA + motivo.

Una fuente NO APTA no puede ser soporte principal del componente.

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

C) Trazabilidad

Bitácora completa usando el formato estandarizado del prompt.

SOP´s - Guías operativas V1

D) Bloqueadores

Si falta fuente apta+cobertura tras 2 intentos ⇒ se lista bloqueador.

SOP´s - Guías operativas V1

4) Roles / HITL (dónde va humano sí o sí)

Operador (humano):

Ejecuta Prompt 2/3 (copy/paste)

Evalúa operabilidad, cobertura, relevancia

Documenta bitácora y registra tablas

SOP´s - Guías operativas V1

QA/Coordinación (humano):

Revisa evidencias (tabla + bitácora)

Dictamina XOR: Aprobado / Corregible / Con bloqueadores

SOP´s - Guías operativas V1

SOP´s - Guías operativas V1

5) Integración con la app (arquitectura existente)

La app base (GO-ESP-01) ya tiene:

rutas /generate, /artifacts, /qa

máquina de estados tipo DRAFT → GENERATING → VALIDATING → READY_FOR_QA → APPROVED + REJECTED/ESCALATED

DOCUMENTACION_DESARROLLO

DOCUMENTACION_DESARROLLO

5.1 Propuesta: nuevo “dominio” para Paso 4 (recomendado)

Agregar domains/curation/ (o domains/phase2/) siguiendo el patrón por dominio existente.

DOCUMENTACION_DESARROLLO

curation.types.ts

curation.service.ts (crear/actualizar corrida de curaduría, persistir tabla/bitácora/bloqueadores)

components/ (tabla editable + bitácora viewer + bloqueadores)

hooks/ (useCurationRun, useCurationValidation, etc.)

5.2 Rutas UI sugeridas

/artifacts/:id/phase2 → vista de Curaduría (tabla + bitácora + validaciones)

/qa/:id/phase2 → QA revisa evidencias y dicta estado

Nota: puedes mantener el mismo “Artifact detail” y meter “Paso 4” como tab dentro del artefacto.

6) Modelo de datos (Supabase) — recomendado

La doc actual lista tablas genéricas (artifacts, qa_sessions, pipeline_events, user_roles).

DOCUMENTACION_DESARROLLO


Para SOP 4 necesitas persistir tabla de fuentes, bitácora y bloqueadores. El diseño más limpio es normalizar por corrida.

6.1 Tablas nuevas (recomendadas)

curation_runs

id

course_id / artifact_id (FK al artefacto del curso)

step_id = "GO-ESP-04"

attempt_number (1 o 2)

status (DRAFT | READY_FOR_QA | APPROVED | CORRECTABLE | BLOCKED)

created_by, created_at, updated_at

qa_decision_by, qa_decision_at

qa_notes (texto breve)

curation_rows (la tabla Lección→Componente→Fuente)

id, curation_run_id

lesson_title

component

is_critical boolean

source_ref (URL/título)

apta boolean

motivo_no_apta text nullable

cobertura_completa boolean

notes (opcional)

curation_blockers

id, curation_run_id

lesson_title

component

impact (texto)

owner (responsable)

status (open/mitigating/accepted)

curation_log_entries (bitácora)

id, curation_run_id

entry_type (decision/discard/gap/next_step)

message

created_at, created_by

6.2 Alternativa “rápida” (menos ideal)

Guardar todo como jsonb en artifacts.phase2_curation:

table_rows[], bitacora[], blockers[]
Funciona, pero complica consultas, QA y auditoría.

7) State machine específica para SOP 4

Basada en tu patrón global, pero ajustada al SOP:

Estados de Fase 2

PHASE2_DRAFT (aún sin fuentes)

PHASE2_GENERATED (salida IA inicial)

PHASE2_HITL_REVIEW (operador marca apta/cobertura, completa bitácora)

PHASE2_READY_FOR_QA

PHASE2_APPROVED

PHASE2_CORRECTABLE

PHASE2_BLOCKED (con bloqueadores)

Transiciones clave

PHASE2_GENERATED → PHASE2_HITL_REVIEW

PHASE2_HITL_REVIEW → PHASE2_READY_FOR_QA (si DoD pasa o si bloqueadores ya documentados)

QA decide XOR:

→ PHASE2_APPROVED

→ PHASE2_CORRECTABLE (puede pedir ajuste documental o permitir Intento 2 si aún no se usó)

SOP´s - Guías operativas V1

→ PHASE2_BLOCKED

8) Validadores (deterministas) que Claude Code debe implementar
8.1 Reglas (tabla → cómo validar → acción)

Cobertura por componente

Validar: para cada (lesson, component) requerido, existe ≥1 row con apta=true y cobertura_completa=true

Si falla:

si attempt_number == 1 ⇒ sugerir Intento 2 (iteración dirigida)

si attempt_number == 2 ⇒ crear blocker

Crítico exige evidencia estricta

Validar: si is_critical=true entonces cobertura_completa debe ser true (y no nulo)

Si falla: bloquear envío a QA (o marcar “Corregible”)

NO APTA requiere motivo

Validar: si apta=false ⇒ motivo_no_apta no vacío

Si falla: error de validación (UI pide completar)

Fuente NO APTA no puede ser “principal”

Validar (pragmático): si un componente solo tiene fuentes apta=false, entonces “sin cobertura” (falla regla 1)

8.2 Severidad sugerida

ERROR (bloquea avanzar): 1,2,3

WARNING (no bloquea, pero QA lo verá): notas vacías, falta de diversidad de fuentes, etc. (esto no está en SOP; opcional)

9) Contrato de integración con QA

Reusar patrón /qa existente:

Entrada QA: curation_run_id en estado PHASE2_READY_FOR_QA

Vista QA:

Tabla completa

Bitácora

Bloqueadores (si existen)

Botones XOR: Approve / Correctable / Blocked

SOP´s - Guías operativas V1

Persistir en qa_sessions o en curation_runs.qa_* (según cómo ya lo tengas montado).

10) Plantillas de prompt y salidas (machine-readable)
10.1 Prompt 2/3 (salida IA)

El SOP exige “Copiar Prompt 2/3” pero no incluye el texto en los extractos visibles; aun así, tu sistema debe forzar que la IA devuelva algo parseable:

Salida requerida (recomendada)

sources_by_lesson[] con:

lesson_title

components[] con:

component_name

is_critical (si viene en el plan)

candidate_sources[] (title + url + short rationale)

Luego HITL: operador marca apta y cobertura_completa en la UI.

Importante: el SOP dice que la bitácora debe completarse “exactamente con los campos del Prompt 2/3”.

SOP´s - Guías operativas V1


Como esos campos no aparecen en el extracto, lo dejo como OPEN_QUESTION abajo.

11) Suite de pruebas (Given/When/Then)
Happy paths

Todo cubierto en intento 1

Given plan con N lecciones y componentes requeridos (incluye críticos)

When IA propone fuentes y operador marca apta+cobertura completa para cada componente

Then validación pasa, estado READY_FOR_QA, QA aprueba ⇒ APPROVED

Intento 2 resuelve brecha

Given falla cobertura en 1 componente tras intento 1

When sistema habilita intento 2 y se agrega fuente apta+cobertura

Then no hay bloqueador y se puede aprobar

Edge cases

Fuente NO APTA sin motivo

When operador marca apta=false

Then validator exige motivo_no_apta (ERROR)

Componente crítico con cobertura incompleta

Given is_critical=true

When cobertura_completa=false

Then bloqueo de avance a QA (ERROR)

Brecha persiste tras intento 2

Given componente sin fuente apta+cobertura tras intento 2

Then sistema crea blocker y permite cierre “Con bloqueadores”

SOP´s - Guías operativas V1

QA dictamina “Corregible”

When QA elige “Corregible”

Then run vuelve a operador; si intento 2 no usado, permitirlo; si ya usado, solo ajuste documental

SOP´s - Guías operativas V1

12) OPEN_QUESTION (necesario para no inventar SOP)

Campos exactos de la Bitácora del Prompt 2/3
El SOP exige “exactamente con los campos del Prompt 2/3”, pero el extracto no muestra esos campos.

SOP´s - Guías operativas V1


Opciones de decisión:

A) Incluir el texto completo del Prompt 2/3 en el repositorio (recomendado) y versionarlo; el schema de bitácora se deriva de ahí.

B) Definir un schema “mínimo” (decision/discard/gap/next_step) y actualizar SOP/prompt para alinearlo.
Impacto: sin esto, no puedes validar “bitácora completa” de forma determinista.

Fuente de verdad / repositorio (Coda vs app)
El SOP habla de “repositorio/tablero”, no fija si es Coda o el sistema.

SOP´s - Guías operativas V1


Default recomendado: la app es fuente primaria; opcional sync a Coda.