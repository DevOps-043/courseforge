# Acceso y selección real de grupos — 2026-11-03

## Diagnóstico

El dominio admite `childGroupIds`, pero la interacción presentaba un defecto:
`beginGesture` seleccionaba el grupo sin modo aditivo durante pointerdown. El
click posterior aplicaba Shift/Ctrl sobre una selección ya sustituida; con
Selección múltiple ocurría el mismo problema. Los fixtures anteriores usaban
click sintético sin pointerdown y no acreditaban esa secuencia real del ratón.

Además, Agrupar selección estaba al final del panel Selección y no existía acceso
directo a grupos desde el timeline. La función tiene una tercera condición,
independiente de la selección: el servidor sólo anuncia capacidad con habilitación
y contrato SQL compatible. No se inspeccionó configuración privada ni el entorno
publicado; no se afirma cuál condición concreta encontraron QA y el usuario allí.

## Corrección local

- El timeline ofrece **Grupos**, que abre el panel Selección existente incluso
  sin selección previa.
- Las acciones de agrupar/anidar aparecen al inicio, en Grupos y jerarquía.
- Una lista del nivel actual permite marcar grupos completos; la operación pura
  de selección conserva otros grupos, elimina sólo el marcado y rechaza otro nivel.
- Shift/Ctrl/Cmd y Selección múltiple se resuelven una sola vez en click. Ese gesto
  no inicia también un arrastre que sustituya la selección. El movimiento normal
  y la selección individual conservan sus flujos existentes.
- La UI explica capacidad deshabilitada incluso con selección vacía y mantiene
  el guard de servidor; agrupar clips libres en la raíz sigue permitido.
- La lista y selección no modifican el documento; agrupar utiliza `group.create`
  y la cola/hash/autorización existentes. No se crea otra persistencia.

## Verificación

| Comando / alcance | Resultado |
| --- | --- |
| `npm run test:composition-nested-groups` | 23/23 aprobadas; incluye selección de hermanos, rechazo de otro nivel, invariantes, hashes y equivalencia de preview/render. |
| `npm run test:composition-nested-groups:sql` | 7/7 aprobadas en PGlite local, sin SQL remoto. |
| `npm run typecheck` | Exit 0. |
| ESLint dirigido a los archivos TS/TSX del cambio, desde apps/web | Exit 0. |
| Runner QA de grupos en Chromium headless | Exit 0 con fuentes actuales: eventos CDP físicos pointerdown/up/click con Shift y Ctrl; activar selección múltiple; casillas por grupo; capacidad desactivada; crear padre con dos subgrupos; serializar/recargar JSON; dos niveles; Enter/Escape; desagrupar; regresión de anidación y arrastre. |
| `git diff --check` del alcance | Exit 0. |
| `npm run verify:pr` | Exit 1 por diagnose-font-catalog sin deltas, ajeno al cambio. Adaptadores, arnés y enlaces pasan; nested-composition-groups valida. No se alcanzó la cadena de producto posterior. |

El runner se ejecuta desde `apps/web` como
`node .tmp/hyperframes-tests/domains/production/composition-editor/qa/run-composition-nested-groups-smoke.js`.
Se transpiló el runner actualizado con esbuild para ejecutarlo; el comando de
dominio compila el resto y el typecheck global valida también el fixture TSX.
Los logs acompañan el reporte. La QA usa componentes reales con datos sintéticos
y persistencia en memoria; la recarga es del JSON, no de Supabase. No representa
una sesión autenticada ni QA visual de toda la aplicación.

## Habilitación y límites

Para agrupar agrupaciones en un entorno se necesitan, en orden:

1. `20261029230000_nested_composition_groups.sql`.
2. `20261029230100_nested_narrative_fragment_groups.sql`.
3. `COMPOSITION_NESTED_GROUPS_ENABLED=true` en servidor.
4. RPC `composition_grouping_capabilities` compatible; caché de 30 s y fallo cerrado.

La anidación visual en un único clip tiene además su capacidad propia y migración
de timeline; no se confunde con agrupar grupos. La entrega no aplica SQL remoto,
modifica secretos o configuración local, publica ni despliega. Activar producción
sigue requiriendo autorización. No se ha comprobado la habilitación del entorno
usado por QA; si la capacidad sigue ausente, el botón seguirá bloqueado con motivo.

Revisión adversarial propia, no independiente: no se eluden permisos, aislamiento,
versionado, límites de profundidad ni origen USER. No cambia compilación audiovisual
ni tablas. Se preservaron cambios ajenos del área de usuarios. Durante rollback
se pueden retirar los accesos nuevos sin migrar documentos; mantener lectores de
jerarquía mientras existan documentos con `groupingVersion: 2`.
