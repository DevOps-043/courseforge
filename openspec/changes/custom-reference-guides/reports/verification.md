# Verificación — líneas de referencia, 2026-10-31

## Entrega
Herramientas → Líneas de referencia abre un panel independiente. Permite orientación, posición en píxeles, color, alta y eliminación (máximo 32), y visibilidad independiente de la rejilla. Las posiciones normalizadas se adaptan al formato. Arrastre en el iframe y flechas (1 px, Shift 10 px) actualizan preferencias locales por draft. Las guías visibles participan en Snap; ocultarlas las excluye.

No cambia el documento, su hash, APIs, SQL, presets ni proveedores. El runtime sólo se serializa en compilación interactiva; las preferencias no se envían al renderer final. La persistencia es local al navegador, sin sincronización entre dispositivos o miembros del equipo.

## Verificaciones ejecutadas
- `npm run typecheck`: salida 0 después de actualizar el fixture de toolbar con el callback nuevo. El primer intento detectó correctamente ese callback faltante en el fixture; se corrigió sin hacer opcional la API del componente.
- `npx tsc -p apps/web/tsconfig.hyperframes-test.json`: salida 0.
- `node --test` sobre composition-reference-guides, composition-preview-protocol, composition-canvas-snap-geometry y composition-canvas-visible-bounds bajo apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__: salida 0, 28 pruebas. Salida en domain-tests.log.
- ESLint desde apps/web sobre useCompositionReferenceGuides, CompositionReferenceGuidesPanel, CompositionPreviewToolbar, NativeCompositionPreview, composition-reference-guides, composition-reference-guides-runtime, composition-preview-protocol y composition-preview-compiler.service con `--quiet`: salida 0.
- `npm run test:hyperframes --workspace=apps/web`: salida 1 por el fallo previo `Cannot find module '@/lib/server/outbound-http'` en composition-agent-model-output. La suite de guías se añadió al inicio del script y pasa. Ver hyperframes.log.
- `npm run verify:pr`: salida 1 por el cambio previo diagnose-font-catalog sin deltas. El cambio custom-reference-guides pasa OpenSpec; adaptadores, arnés y enlaces pasan. La verificación posterior de producto no se alcanza. Ver verify-pr.log.
- `git diff --check`: salida 0.

## QA en Chrome
Comando desde raíz, tras compilar pruebas:

```powershell
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node openspec/changes/custom-reference-guides/reports/guides-smoke.cjs
```

Salida 0. Chrome headless se ejecutó fuera del sandbox con perfil temporal, servidor loopback y fixture sintético de texto. Panel, hook de preferencias y compilador/iframe son reales. Se probaron:
- Crear vertical, posición 600 px y color magenta; rechazo de color arbitrario enviado directamente al runtime.
- Arrastre real con CDP hasta 720 px sin commits de clip; Shift+flecha a 730 px, conservando foco después de la sincronización.
- Guía en 613 px, fuera de rejilla: el borde derecho del clip encaja en 613 y deja X=413. Al ocultar, el mismo movimiento usa sólo rejilla y deja X=416.
- Recarga del navegador conserva guía, color y visibilidad; creación horizontal y eliminación actualizan DOM y preferencias.
- Patch real de escena cambia canvas a 1080×1920: la guía horizontal permanece al 50% y el panel muestra 960 px.

El primer harness de recarga perdió un evento ready emitido antes de montar su listener. Se añadió detección de disponibilidad al harness; no se cambió el handshake del producto. Se separaron eventos de checkbox/alta para reproducir interacciones distintas del usuario y evitar batching artificial dentro de una misma evaluación.

## Revisión adversarial y límites
Revisión por el mismo agente: schemas cerrados, IDs UUID, posiciones finitas 0–1, color hexadecimal y límite 32; storage con tamaño limitado y errores visibles. IDs repetidos y valores malformados se rechazan. El padre verifica fuente, generación y schema del mensaje, actualizando sólo una guía existente. El runtime usa text/atributos fijos y colores validados, sin HTML/CSS arbitrario. No hay autoridad nueva sobre documentos o recursos.

Las pruebas verifican que el HTML de HYPERFRAMES_RENDER no contiene clases ni mensajes de guías y que compilar no muta el documento. No se ejecutó render cloud/video final, E2E autenticado, QA completa responsive ni prueba de cuotas reales de almacenamiento. Las fallas de storage se probaron como excepciones de lectura/escritura en suite; los mensajes del hook se revisaron por código. No se afirma validación remota. Las preferencias no se comparten ni se incluyen en deshacer/rehacer del video.
