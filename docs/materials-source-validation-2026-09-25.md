# Referencias válidas rechazadas en materiales — 25 de septiembre de 2026

## Causa confirmada

El artefacto `abe6b74e-4db6-4d5e-b2fc-1528ac12e728` tiene 20 lecciones con el mismo fallo de Control 4. La primera se guarda como `lesson-1-1-G1`, mientras que el plan y sus fuentes usan `lesson-1-1`.

La generación reconoce el sufijo `-Gn` mediante `matchesLesson`. La validación posterior construía sus mapas con los identificadores del plan y los consultaba con los identificadores de materiales, obteniendo un conjunto vacío. También perdía el requisito de cantidad de fuentes del plan. Por eso regenerar contenido no resolvía el fallo.

Las tres referencias de la primera lección existen en la curación del artefacto, pertenecen a `lesson-1-1`, tienen `apta: true` y `validation_report.status: valid`. El diagnóstico remoto registró `iteration_count: 6` y `max_iterations: 5`; esta corrección conserva esos contadores como historial, sin aumentar el límite.

## Corrección

- `materials-source-context.ts` comparte la carga de fuentes aprobadas entre generación y validación. Construye el contexto con las lecciones persistidas y reutiliza `findLessonSources` y `findPlanDetails`, sin una segunda regla de normalización.
- Los identificadores distintos siguen excluidos aunque sus títulos coincidan. Se conserva la compatibilidad por título cuando falta un identificador.
- Control 4 cuenta únicamente referencias distintas que pertenecen al conjunto válido para comprobar la cobertura mínima.
- La validación individual admite volver a comprobar una lección `NEEDS_FIX` y la interfaz ofrece «Volver a validar» cuando existen componentes, sin consumir una generación. La validación global sigue preservando las lecciones marcadas para corrección.

## Recuperación y verificación

La comprobación de solo lectura con el código corregido pasó los tres controles de las 20 lecciones y sus 99 componentes existentes. Se recuperaron los estados y el DoD, con copia previa local en `.tmp/incident-backups/materials-source-validation-2026-09-25-1790355153968.json` y comparación de versión/estado/timestamps. La lectura posterior confirmó las 20 lecciones en `APPROVABLE`, todos los componentes y contadores intactos, y materiales en `PHASE3_READY_FOR_QA`, versión 7 y `qa_decision: null`. La aprobación humana de QA sigue pendiente.

Las pruebas de regresión cubren 20 identificadores con sufijo, requisitos de cobertura derivados del plan, títulos repetidos, datos antiguos sin identificador, referencias ajenas, referencias duplicadas, ausencia de fuentes y ruta sin fuentes. También comprueban que la carga se acota al artefacto y excluye informes de validación fallidos o pendientes.

Resultado: 34 pruebas de materiales aprobadas, `npm run typecheck`, `npm run lint`, `npm run architecture:cycles` y `git diff --check` aprobados. Se restauraron las dependencias locales declaradas sin cambios en manifiestos ni lockfile y se regeneraron los tipos obsoletos de Next.js para comprobar el árbol actual. No se ejecutó un despliegue ni una prueba de navegador autenticada.

La corrección de código necesita desplegarse para que futuras validaciones remotas utilicen el criterio corregido.
