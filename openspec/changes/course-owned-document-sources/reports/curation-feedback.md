# Claridad de la revisión y seguimiento de búsqueda

Fecha: 2026-11-20.

## Diagnóstico y cambio

CourseSourceCuration iniciaba startCurationAction sin deshabilitar el botón,
indicador inmediato ni consulta posterior del estado. La rama documental reemplaza
el contenedor web que sí posee seguimiento; por eso el usuario podía iniciar una
búsqueda sin ver su ejecución.

CourseSourceSearchStatus utiliza el snapshot autorizado existente de curación para
leer estado y cantidad de filas. Muestra inicio inmediato, búsqueda/validación,
pausa, bloqueo, finalización, errores de inicio y consulta manual. Consulta cada
tres segundos durante la ejecución y recupera el estado al montar el componente.
Evita otro inicio mientras una llamada o ejecución esté activa. El inicio solicita
resume=true para completar pendientes conservando las fuentes existentes.

No transforma una fuente encontrada en cobertura aprobada. El snapshot conserva
el comportamiento existente de reconciliación de curación web; no se modifica la
aprobación humana de asociaciones documentales. Los conteos representan filas de
fuentes, no porcentaje de progreso ni suficiencia pedagógica.

CourseSourceReviewPanel explica reunir evidencia, proponer asociaciones, verificar,
guardar y aprobar. Presenta cantidad de evidencia, requisitos pendientes, ayuda
para «Sin evidencia», falta de plan y ausencia de fuentes. Durante proponer/guardar
muestra actividad. La aprobación se deshabilita mientras las asociaciones locales
difieran de las guardadas. Los controles del servidor permanecen vigentes.

No se actualiza automáticamente el editor al llegar fuentes para no sobrescribir
ediciones humanas. Se explica que «Actualizar revisión» recarga la evidencia y
reemplaza cambios no guardados.

## Verificación

QA con componentes reales, acciones/API simuladas y navegador local sin red externa:

- scripts/qa-course-source-search.cjs: inicio inmediato, doble inicio bloqueado,
  recuperación de ejecución al recargar, finalización por polling, bloqueo y fallo
  de inicio visible; móvil sin desbordamiento y sin errores React.
- scripts/qa-course-source-policy.cjs: política persistente, propuestas sin verificar,
  resolución de conflicto, guardado/aprobación, recarga y rechazo de revisión antigua.
- Capturas inspeccionadas: `.tmp/source-search-qa/running.png` y
  `.tmp/source-review-help-qa/mobile-dark.png`.

No se inició otra generación real ni se confirmó el resultado de la ejecución
previa del usuario. Sin despliegue, SQL ni cambios de permisos.

Logs: `.tmp/source-search-qa.log`, `.tmp/source-review-help-qa.log`,
`.tmp/source-search-types.log` y `.tmp/source-search-lint.log`.

ESLint de los tres componentes con cero avisos, arnés y diff dirigido: aprobados.
La comprobación completa de tipos está bloqueada por sintaxis corrupta en el
archivo generado apps/web/.next/dev/types/validator.ts (líneas 1817–1820, texto
residual «f handler>»). No se modificó ese archivo del servidor de desarrollo.
docs:check mantiene los cuatro enlaces locales rotos del reporte Herk previamente
documentados. No se ejecutó verify:pr completo.

Diagnóstico complementario de TypeScript con las mismas opciones y fuentes, salvo
el archivo generado corrupto: aprobado. Script local de la sesión
`.tmp/typecheck-source-search.cjs`, salida `.tmp/source-search-types-focused.log`.
No sustituye la comprobación completa ni cambia el tsconfig del producto.
