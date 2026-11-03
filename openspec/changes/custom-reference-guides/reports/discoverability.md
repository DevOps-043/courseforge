# Acceso visible a guías — 2026-11-03

## Diagnóstico

La función estaba implementada: panel, preferencias locales por draft, runtime
interactivo, arrastre, teclado, color, posición y Snap. Su único acceso estaba en
Herramientas → Líneas de referencia. «Rejilla» correspondía a una cuadrícula fija
y podía confundirse con la personalización. La toolbar compacta ocultaba además
los textos de los botones.

## Corrección

- Botón directo **Guías** junto al monitor, con texto visible incluso en barra
  compacta, estado activo, `aria-expanded` y panel enlazado por ID único.
- El botón abre/cierra el panel; se conserva el acceso anterior del menú.
- «Rejilla fija» identifica la cuadrícula. El panel explica la diferencia,
  persistencia local y cómo crear la primera línea.
- Abrir enfoca el panel; Escape y Cerrar guías permiten salir sin borrar líneas.
- Los umbrales de controles secundarios pasan de 44 a 48 rem y de 30 a 36 rem.
  En menos de 26 rem se compactan formato y espaciado, conservando Guías, zoom y
  apertura del inspector. Los formatos muestran primero la proporción para que
  siga legible en el selector compacto.

La primera QA detectó solapes a 1280/1100 px con inspector y a 390 px. Se
corrigieron los umbrales y se repitió la matriz completa hasta aprobar. No se
relajaron las comprobaciones de desbordamiento, altura ni accesibilidad.

## Evidencia ejecutada

- `npm run typecheck`: exit 0.
- ESLint dirigido desde `apps/web` a toolbar, panel, integración nativa y fixture/
  runner de toolbar con `--quiet`: exit 0.
- `node .tmp/hyperframes-tests/domains/production/composition-editor/qa/run-composition-toolbar-layout-smoke.js`
  desde `apps/web`: exit 0. Chromium real con CSS real en 1365, 1280, 1100, 1024,
  768 y 390 px, inspector abierto/cerrado: barra de hasta 52 px, sin controles
  solapados ni recortados, texto Guías visible, alta desde el botón, cierre/reapertura
  sin pérdida, foco/Escape y regresión de menú/historial.
- `node openspec/changes/custom-reference-guides/reports/guides-smoke.cjs` desde
  raíz: exit 0. Panel/hook/iframe reales con datos sintéticos: color, posición,
  inválidos, arrastre, teclado, Snap, ocultar, recarga local y cambio de formato.
- `node --test` sobre las suites compiladas `composition-reference-guides`,
  `composition-preview-protocol`, `composition-canvas-snap-geometry` y
  `composition-canvas-visible-bounds`: 28/28 aprobadas, exit 0. Incluye exclusión
  de guías del render y compilación sin mutar el documento.
- `git diff --check` del alcance: exit 0.
- `npm run verify:pr`: exit 1 por el cambio ajeno `diagnose-font-catalog`, sin
  deltas. Adaptadores, arnés y enlaces pasan; `custom-reference-guides` valida.
  No se alcanzó la cadena de verificación de producto posterior.

Los logs acompañan este reporte. Se reutilizaron las suites compiladas del
dominio porque sus fuentes no cambiaron. El runner de toolbar se transpiló con
esbuild y se ejecutó con fixtures actuales; la compilación global comprueba sus
tipos. Los navegadores headless se ejecutaron fuera del sandbox, con perfiles
temporales. No se abrió una sesión de producto autenticada ni se realizó render
pagado, publicación o despliegue.

## Revisión y límites

Revisión propia, no independiente. No se modifican schemas, autoridad de mensajes,
preferencias, almacenamiento local, Snap, documentos ni compilador de render.
No hay SQL, API, dependencia o permiso nuevo. Se preservaron los cambios ajenos
del área de usuarios encontrados al comenzar.

Las guías son locales al navegador y no se comparten con el equipo. No forman
parte del video ni de deshacer/rehacer de la composición. Para probar tras el
despliegue: abrir Guías en el monitor, añadir horizontal/vertical, modificar
posición/color, cerrar/reabrir y recargar el mismo borrador.

La reversión restaura toolbar/panel y sus estilos anteriores, sin migrar datos.
La entrega está en el checkout principal y requiere desplegar el frontend para
aparecer en un entorno publicado.
