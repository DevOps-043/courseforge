# Distribución visual del plan instruccional

Fecha: 2026-11-20.

El paso 3 híbrido presenta un encabezado común y un selector entre sesiones en
vivo para Hub y estudio asíncrono para Academy. Muestra un apartado a la vez y
mantiene ambos montados para conservar ediciones y seguimiento de ejecuciones.
La aprobación conjunta sigue en el apartado de sesiones en vivo.

El plan de Academy aprovecha el ancho del contenedor. El prompt está en un
desplegable avanzado cerrado inicialmente, con origen y versión visibles.
La generación queda accesible sin desplegarlo. El interruptor de personalización
tiene nombre accesible, estado y foco visible. Los resultados permiten que las
acciones salten de línea en pantallas estrechas.

No cambian contratos, generación, permisos ni datos persistidos. Los cursos
asíncronos conservan su pantalla de plan y reciben el prompt plegable; los
puramente síncronos conservan el panel de sesiones.

## Evidencia

- QA local de los componentes reales HybridPlanLayout e InstructionalPlanSetupView,
  con contenido Hub simulado y sin APIs: selector, panel oculto, prompt cerrado,
  personalización y conservación del texto al alternar destinos; sin errores React.
- Capturas inspeccionadas a 1366 y 390 px; móvil sin desbordamiento horizontal.
  También se capturó tema claro. Artefactos locales en `.tmp/plan-layout-*.png`;
  ejecución reproducible de esta sesión en `.tmp/qa-plan-layout.cjs`.
- No equivale a una prueba autenticada de la página completa ni a generación real.
- `npm run typecheck`: aprobado tras la revisión final.
- ESLint dirigido de ArtifactStageContent, HybridPlanLayout, SetupView y
  ResultsView con `--max-warnings 0`: aprobado. El contenedor de generación,
  cuyo único cambio es pasar la propiedad academyOnly, mantiene su aviso previo
  `react-hooks/set-state-in-effect` registrado en eslint-warning-baseline.json;
  la comprobación inicial de los cinco archivos no pasó por ese aviso.
- `git diff --check`: aprobado, con avisos de normalización CRLF.
- No se ejecutó `verify:pr` completo en esta entrega visual.
- `harness:validate`: aprobado. `docs:check` continúa bloqueado por cuatro
  enlaces locales preexistentes en reportes/2026-11-14-factibilidad-herk-edit-kit.md
  hacia otro checkout; no se modificó ese reporte ajeno al ajuste.
- Las pruebas con grupos/lotes quedan para la siguiente entrega, según la prioridad
  indicada por el usuario.

Comandos y salidas: `.tmp/plan-layout-qa.log`,
`.tmp/plan-layout-types-final.log`, `.tmp/plan-layout-lint-final.log`.

## Separación del aviso de Academy (2026-11-21)

Se añadieron 24 px debajo del aviso compartido, 8 px entre su título y descripción
y mayor interlineado. Evita que el encabezado de Materiales quede pegado al aviso;
la misma separación aplica a las etapas que reutilizan ese bloque. Cambio de
presentación, sin iniciar ni modificar ejecuciones de generación.
