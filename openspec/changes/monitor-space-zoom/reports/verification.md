# Verificación — espacio y zoom, 2026-10-31

## Causa y entrega
El marco anterior limitaba ancho a 58rem, guardaba proporción también fuera del iframe y tenía padding amplio. Laterales 18.5/20rem y timeline mínima 12rem reducían el área central; controles limitaban zoom a 75–175% aunque la geometría admitía 50–200%.

Se amplió zoom a 25–400% en UI/protocolo/runtime y geometría compartida con áreas seguras. Popover con slider (paso 5%), porcentaje exacto, presets y Encajar (100% del área disponible). La vista normal inicia con más altura (74%) y laterales más estrechos; separador permite 30–85%. Modo Ampliar monitor conserva paneles montados y proporción anterior, ocupa su ancho y empieza en 82%; Fullscreen API sigue independiente.

Archivos: config de vista, hook de controles, toolbar/popover, CSS, integración NativeCompositionPreview, geometría/protocolo/compilador y fixtures/tests. Sin modificación de documento, clips, assets, APIs de persistencia o render final.

## Verificaciones
- `npm run typecheck`: salida 0 con el fixture actualizado; repetido tras los ajustes finales de toolbar.
- `npx tsc -p apps/web/tsconfig.hyperframes-test.json`: salida 0.
- `node --test` sobre composition-preview-view, composition-preview-viewport-geometry y composition-preview-protocol bajo apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__: salida 0, 17 pruebas. Ver domain-tests.log. Se incluyen las dos suites de vista/geometría al inicio de test:hyperframes.
- ESLint desde apps/web sobre CompositionPreviewZoomControls, CompositionPreviewToolbar, NativeCompositionPreview, useCompositionStudioControls, config de vista, geometría y compilador con --quiet: salida 0; repetido para toolbar/popover/hook tras cambios finales.
- `npm run test:hyperframes --workspace=apps/web`: salida 1 por el fallo anterior `Cannot find module '@/lib/server/outbound-http'` en composition-agent-model-output. Las suites nuevas iniciales pasan. Ver hyperframes.log.
- `npm run verify:pr`: salida 1 por diagnose-font-catalog sin deltas, anterior al cambio. Este cambio pasa OpenSpec; adaptadores, arnés y enlaces pasan. No se alcanza la verificación posterior de producto. Ver verify-pr.log.
- `git diff --check`: salida 0.

## QA real de navegador y medición
Desde raíz, después de compilar pruebas:

```powershell
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node openspec/changes/monitor-space-zoom/reports/monitor-smoke.cjs
```

Salida 0, registrada en browser-qa.log y measurements.json. Se usa Chrome headless fuera del sandbox de ejecución, perfil temporal, servidor loopback y composición sintética. El iframe del producto conserva sandbox="allow-scripts"; la prueba lo inspecciona mediante su propia sesión CDP (iframe aislado). No se añadió allow-same-origin ni se debilitaron permisos.

La comparación utiliza CSS, toolbar y hook reales del commit 5aed69dc frente a los actuales, en el mismo fixture con biblioteca e inspector abiertos. El iframe usa el compilador actual en ambas mediciones a zoom=1. Son medidas del fixture, no de una sesión autenticada ni una promesa para todas las pantallas.

| Ventana | Video anterior | Video normal nuevo | Monitor ampliado |
|---|---|---|---|
| 1365×768 | 567×319 | 681×383 | 732×412 |
| 1365×900 | 674×379 | 772×434 | 967×544 |
| 1920×1080 | 917×516 | 1090×613 | 1230×692 |

En 1365×768 el área normal crece aproximadamente 44%; en 1920×1080, 41%. El modo ampliado gana más área sin fullscreen y restaura la proporción anterior y el valor del input de biblioteca sin remontarlo.

Se probaron 25/100/137/400%, rechazo de 500% en el campo, slider/presets/Encajar, coincidencia de áreas seguras a 400%, Escape/foco, lienzo vertical/cuadrado/horizontal, Fullscreen API real con gesto CDP y popover dentro de ventana a 1280/1100/1024/768/390 px.

También se ejecutó desde apps/web `node .tmp/hyperframes-tests/domains/production/composition-editor/qa/run-composition-toolbar-layout-smoke.js`: salida 0. Regresión existente confirma toolbar de una fila <=52 px, sin solapamientos, herramientas/foco/historial en seis anchos (1365,1280,1100,1024,768,390) con inspector abierto/cerrado. La primera ejecución detectó superposición a 390; se corrigió moviendo deshacer/rehacer al menú bajo 26rem y se repitió hasta pasar.

## Hallazgos durante QA
- La lectura directa del iframe falló por sandbox y el frame tree del padre no incluía el iframe aislado. El harness se adaptó a Target.attachToTarget/CDP y a esperar la navegación vigente; permisos del producto intactos.
- El helper de clic se ajustó a enfocar el control, como hace un clic de usuario, y a aislar sus variables entre evaluaciones.
- La prueba de áreas seguras detectó el borde nativo del iframe en el fixture sin preflight: se declaró border:0 en CSS del monitor y se repitió la prueba completa.

## Revisión y límites
Revisión adversarial por el mismo agente: escala finita y acotada, sin mutar layout ni resolución; estado de vista local sin nuevas rutas/autoridad. El iframe y overlays usan el mismo centrado y los controles de transformación conservan escala inversa. La vista ampliada no desmonta laterales; los accesos de inspector/biblioteca restauran distribución antes de abrirlos (integración revisada por diff).

El zoom es centrado, sin pan: por encima de 100% puede ocultar bordes de la vista; Encajar los recupera sin recortar el video. No se ejecutó E2E autenticado completo, build/QA de CI ni render cloud. Las pruebas de distribución usan contenido sintético de biblioteca/timeline; validar flujos de una lección real durante rollout. La composición, exports y permisos permanecen bajo sus contratos existentes.
