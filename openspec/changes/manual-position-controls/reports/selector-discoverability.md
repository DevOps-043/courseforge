# Selector horizontal visible — 2026-11-03

## Diagnóstico y corrección

La implementación previa sí incluía deslizadores, pero la rama de medios los
colocaba debajo de tiempo y audio. Antes mostraba campos X/Y duplicados que
solo cambiaban estado, sin emitir el preview temporal. La QA previa del control
aislado no comprobaba su ubicación dentro del inspector completo.

`CompositionInspector` ahora muestra una única sección «Posición manual» al
inicio de las propiedades del clip visual, antes de capas, tiempo y audio.
`CompositionPositionControls` identifica «Horizontal (X)» y «Vertical (Y)»,
destaca la sección y explica la vista en tiempo real. Conserva campos numéricos
en píxeles, nombres accesibles, rangos, negativos y precisión decimal.

La ruta de acceso es seleccionar un clip visual → panel derecho → Propiedades
(icono de deslizadores) → Posición manual → Horizontal (X). No se necesita una
función nueva del servidor, migración, flag ni cambio de contrato de documento.

## Validación ejecutada

- `npm run typecheck`: exit 0.
- Desde `apps/web`, ESLint sobre `CompositionInspector.tsx` y
  `CompositionPositionControls.tsx` con `--quiet`: exit 0.
- `node openspec/changes/manual-position-controls/reports/position-controls-smoke.cjs`:
  exit 0 en Chromium headless. Conserva los escenarios anteriores de iframe
  real y añade el inspector completo VIDEO/IMAGE/DECK_SLIDE/TEXT/CAPTION:
  selector único, ubicación antes de tiempo/audio, preview antes de guardar,
  ausencia de commits durante el gesto, commit al soltar y bloqueo de pista.
- `node --test` sobre las suites compiladas `composition-position-preview-runtime`,
  `composition-preview-protocol`, `composition-interaction-autosave` y
  `composition-local-edits`: 37/37 aprobadas, exit 0. Se reutilizó la compilación
  existente: no se modificaron sus fuentes TypeScript en este cambio.
- `git diff --check` del alcance: exit 0.
- `npm run verify:pr`: exit 1 por `diagnose-font-catalog` sin deltas. Adaptadores,
  arnés y documentación pasan; `manual-position-controls` valida. La compuerta
  no alcanzó la verificación de producto posterior. No se corrigió ese cambio
  ajeno ni se afirma verde global.

Los logs del navegador, regresión y tipos acompañan este reporte. La ejecución
de navegador se realizó fuera del sandbox, con datos sintéticos, callbacks de
persistencia en memoria, controles React reales y preview real compilado. No
acredita sesión autenticada, recarga desde Supabase, fidelidad visual de la página
completa ni render cloud. No se ejecutó generación pagada ni despliegue.

## Revisión y reversión

Revisión propia, no independiente: no cambian identidad, permisos, servidor,
persistencia ni el canal de preview. Se preserva la limpieza de preview al
bloquear o cambiar selección. Audio no recibe controles de posición. El tamaño,
rotación y opacidad mantienen sus ajustes y no se modifican al mover X/Y.

Se conservaron los cambios ajenos del área de usuarios encontrados al iniciar.
La reversión consiste en devolver la presentación anterior; no requiere revertir
datos. El cambio queda local hasta desplegar el frontend compatible.
