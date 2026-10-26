# Integración en staging

Fecha: 2026-10-26. Integración solicitada por el usuario; trabajo realizado exclusivamente en el repositorio principal, sin crear worktrees.

## Historial y alcance

- Base remota comprobada mediante fetch: staging en `554cc397db71f9b860aeb26db9947f7f49d93d88`.
- Avance directo local hasta `529895152ed1a810359faeaf129ea64ddfaa46b7`, sin conflictos ni divergencia.
- Incluye el ancestro `e90b75f0` de bases de plantillas HTML y el commit `52989515` de autoría sincrónica/híbrida.
- Especificaciones canónicas sincronizadas y ambos cambios archivados después de la integración. Los cinco pendientes de pruebas autenticadas, compuerta global, línea base y piloto siguen abiertos en las tareas archivadas.
- La capacidad permanece desactivada por defecto. No se aplicó SQL remoto, no se alteraron variables del entorno y no se probaron proveedores reales.

## Verificación de esta integración

- `npm run test:course-delivery`: 22 pruebas correctas.
- `node --test scripts/test-course-delivery-sql.mjs`: 11 pruebas correctas con PGlite temporal y esquema fixture.
- `npm run db:migrations:check`: correcto, 211 SQL.
- `npm run test:harness`: 20 pruebas correctas al ejecutarlo fuera del sandbox; el primer intento falló por permisos al crear repositorios Git temporales.
- `npm run test:security-boundaries`: correcto.
- `npm run docs:check`: correcto, 151 documentos tras el archivo; `git diff --check` correcto. Ambas especificaciones canónicas nuevas validan en modo estricto.
- `npm run verify:pr`: adaptadores, arnés y enlaces correctos; se detiene en OpenSpec por el cambio previo `diagnose-font-catalog`, sin deltas. La especificación de este cambio valida. No se modificó ni omitió la compuerta.
- Revisión del mismo agente: el avance directo conserva exactamente el código probado; el cierre añade documentación y sincroniza especificaciones, sin resolver tareas operativas mediante afirmaciones de éxito.

## Operación y reversión

La subida a origin/staging puede activar la automatización configurada para esa rama; su despliegue y estado de CI deben verificarse por separado. La integración de código no habilita la capacidad ni acredita una migración aplicada.

Para revertir la autoría sincrónica, usar un commit de reversión de `52989515`, preservando el historial; antes de revertir una aplicación habilitada, desactivar nuevas operaciones y revisar la guía operativa. No borrar tablas, versiones, respaldos ni datos de cursos para revertir código. El commit de plantillas HTML es independiente y requiere evaluación separada.
