# Verificación — 2026-10-31

Esta evidencia corresponde a la entrega inicial `47e71625`. La ampliación de
preview en tiempo real y sus límites se registran en [la verificación posterior](realtime-verification.md).

## Entrega
Componente compartido CompositionPositionControls, integración en las dos ramas visuales de CompositionInspector y dimensiones del lienzo desde NativeCompositionPreview. Campos en píxeles, deslizadores de paso entero y rango basado en el lienzo. La escritura numérica conserva decimales. La validación local rechaza X/Y fuera del esquema; el servidor mantiene su validación existente.

## Comandos y resultados
- `npm run typecheck`: salida 0, repetido después de agregar validación de límites.
- Desde `apps/web`, `npm exec -- eslint src/domains/materials/components/composition-editor/CompositionPositionControls.tsx src/domains/materials/components/composition-editor/CompositionInspector.tsx src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx --quiet`: salida 0. El primer intento desde raíz falló por no encontrar configuración; se corrigió el directorio de ejecución.
- `npm run test:hyperframes --workspace=apps/web`: salida 1. Compilación completada, suites anteriores ejecutadas; detención en composition-agent-model-output por `Cannot find module '@/lib/server/outbound-http'`. Ese módulo y su configuración no se modificaron. Salida en hyperframes.log.
- `node --test apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-interaction-autosave.test.js apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-local-edits.test.js`: salida 0, 21 pruebas. Incluye conservación de movimientos pendientes y patch que cambia sólo X sin timing/opacidad redundantes.
- `node --test apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/editor-patch.service.test.js`: salida 0, 83 pruebas. Salida en editor-patch.log.
- `node --test apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-preview-compiler.service.test.js`: salida 1, 41/42 pruebas. La prueba restante espera branding `SofLIA - Engine remote asset`; el compilador genera `SofLIA Architect remote asset`. Ambos archivos permanecen sin cambios. Salida en preview-compiler.log.
- `npm run verify:pr`: salida 1. Adaptadores, arnés y enlaces pasan; OpenSpec valida este cambio y falla en diagnose-font-catalog, que carece de deltas. Se confirmó con `npx openspec validate diagnose-font-catalog --type change --strict --no-interactive`, salida 1. La compuerta no alcanzó la verificación posterior de producto. Salida en verify-pr.log.
- `git diff --check`: salida 0.

## Prueba del componente en navegador
`$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'; node openspec/changes/manual-position-controls/reports/position-controls-smoke.cjs`: salida 0. Chrome headless necesitó ejecución fuera del sandbox porque crashpad fallaba dentro. Edge no completó el inicio y los dos intentos se interrumpieron. La ejecución aprobada utilizó servidor loopback, componente React real, boundary real, esquema real y datos sintéticos.

Resultado: PASS para negativos, sincronización del campo con el deslizador, ausencia de guardados durante arrastre, confirmación al soltar, decimales numéricos, entradas vacías/fuera del esquema, bloqueo por fieldset y cambio de rango según formato. El harness sustituye el callback de persistencia por una captura en memoria.

## Revisión adversarial y límites
Revisión del mismo agente: el nuevo control no crea endpoints, no concede permisos, no modifica motion ni tamaño, y usa el boundary existente. Sin dependencias nuevas ni acceso a secretos. Se comprobó por diff su inclusión en texto/subtítulos y medios; audio mantiene su rama independiente.

No se ejecutó E2E autenticado con Supabase, recarga tras persistencia, QA visual de la página completa ni render final. El monitor refleja la edición al confirmar el gesto por el flujo existente; no se implementa preview por cada movimiento del deslizador. Las flechas y el arrastre existentes no se modificaron; no se probó manualmente su regresión en una sesión autenticada. Los fallos generales se documentan y no se consideran resueltos.
