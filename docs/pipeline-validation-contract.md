# Contrato de validacion del pipeline

Este contrato centraliza las reglas server-side que permiten avanzar entre fases.
La UI puede mostrar estados o ayudas, pero no es autoridad para aprobar una fase.

## Modulos

- `apps/web/src/lib/pipeline-validation.ts`: reglas puras, testeables y sin Supabase.
- `apps/web/src/lib/server/pipeline-validation.server.ts`: carga el snapshot minimo desde Supabase y ejecuta las reglas.
- Acciones server-side: llaman `assertPipelinePhaseAllowed()` antes de transiciones criticas.

## Fases cubiertas

| Fase | Gate | Requisitos minimos |
| --- | --- | --- |
| BASE | `BASE` | Idea central, objetivos, nombres y generacion terminada. |
| SYLLABUS | `SYLLABUS` | BASE valida, modulos/lecciones, validacion automatica aprobada y sin `upstream_dirty`. |
| PLAN INSTRUCCIONAL | `INSTRUCTIONAL_PLAN` | SYLLABUS aprobado por QA, lecciones de plan, validacion ejecutada, sin bloqueadores. |
| CURACION | `CURATION` | PLAN aprobado, curacion lista para QA, fuentes existentes, fuentes sin decision pendiente ni URL rota aprobada. |
| MATERIALES | `MATERIALS` | CURACION aprobada, materiales listos para QA, lecciones `APPROVABLE`, sin bloqueadores globales. |
| PRODUCCION | `PRODUCTION` | MATERIALES aprobados, produccion marcada completa y al menos un asset visual/video asociado. |
| PUBLICACION | `PUBLICATION` | PRODUCCION valida, borrador `READY`, slug, categoria, nivel e instructor. |

## Transiciones protegidas

- Aprobar BASE: `updateArtifactStatusAction(..., "APPROVED")`.
- Aprobar SYLLABUS: `updateSyllabusStatusAction(..., "STEP_APPROVED")`.
- Aprobar PLAN: `updateInstructionalPlanStatusAction(..., "STEP_APPROVED")`.
- Iniciar CURACION: `startCurationAction()`.
- Aprobar CURACION: `updateCurationStatusAction(..., "PHASE2_APPROVED")`.
- Iniciar/enviar MATERIALES a QA: `startMaterialsGenerationAction()` y `submitMaterialsToQaAction()`.
- Aprobar MATERIALES: `applyMaterialsQaDecisionAction(..., "APPROVED")`.
- Preparar PUBLICACION: `savePublicationDraft(..., { status: "READY" })`.
- Enviar a Soflia: `POST /api/publish`.

## Extension

Para agregar una regla:

1. Agregar el chequeo en `pipeline-validation.ts`.
2. Cubrirlo con un test en `apps/web/src/lib/__tests__/pipeline-validation.test.ts`.
3. Si necesita mas datos, ampliar el select minimo en `pipeline-validation.server.ts`.
4. Conectar el gate solo en la accion server-side que cambia estado o dispara la siguiente fase.
