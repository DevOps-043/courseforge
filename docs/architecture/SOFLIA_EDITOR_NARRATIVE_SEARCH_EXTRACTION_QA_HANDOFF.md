# Búsqueda y extracción narrativa — entrega a QA

Fecha: 2026-10-06. Implementación conectada; aceptación QA y rollout **no aprobados**.
Fuente de alcance: `SOFLIA_EDITOR_NARRATIVE_SEARCH_EXTRACTION_IMPLEMENTATION_PLAN.md`, bloques 0–5.
No cierra ni cambia estados de CAPs del otro flujo.

## 1. Qué se entrega

- Búsqueda literal en títulos, guion y palabras temporizadas; Unicode/acentos/ñ, resultados y navegación existentes.
- Rango consecutivo de una ocurrencia, ajuste manual limitado al clip y preescucha con transporte existente.
- Copia de voz al final, sin borrar original ni crear un asset procesado.
- Copia audiovisual de pistas explícitas, incluyendo grupos/enlaces obligatorios y captions nativos compatibles.
- Intención revisada, reconstrucción servidor, append/recibo atómico preparado, recuperación de ACK perdido y recarga/historial compartidos.
- Rechazo explícito de HTML/deck editable sin clonación segura, rate/freeze, efectos/fades/transiciones incompatibles y dependencias incompletas. No se ofrecen estos casos como soportados.

No se entrega exportador nuevo, STT, búsqueda semántica, eliminación/ripple ni biblioteca de fragmentos entre proyectos.
Metadatos concordantes no certifican bytes o exactitud de transcripción. Preescucha es la mezcla de la composición, no voz aislada.

## 2. Auditoría de implementación por requisito

Prefijos: dominio = `apps/web/src/domains/production/composition-editor/`; UI = `apps/web/src/domains/materials/components/composition-editor/`.

| Requisito del plan | Evidencia implementada inspeccionada | Pendiente de aceptación |
|---|---|---|
| Bloque 0: identidad/procedencia y restricciones | occurrence/range services; query/repositorios scoped; fingerprints de review e intención; contratos strict; binding REGISTRY_METADATA_MATCH_ONLY | Correspondencia con audio hablado real |
| Bloque 1: búsqueda literal, ámbito y navegación | search service; UI CompositionNarrativeSearch montada en NarrativePanel; mark React, anterior/siguiente, resultados separados, presupuestos y ámbito por escena | Teclado, lector, rendimiento y navegación en navegador |
| Bloque 2: selección consecutiva y transporte único | RangeControls; range service; NativeCompositionPreview usa seek/play/pause actuales, stop al end, timeout/cancelación y revisión vigente | Timing perceptual/browser, desmontaje/foco y audio real |
| Bloque 3: copia de voz no destructiva | voice planner/reducer, query/apply/recovery, rutas narrative-extraction, migración de receipts, host/historial y flags | SQL real, undo/redo/recarga y permisos |
| Bloque 4: audiovisual completo elegible | fragment planner, selección exacta de tracks/dependencias/grupos, captions recortados sin regeneración, fonts/assets bindings; rutas narrative-fragment; guards/delta/atomic SQL preparados | Equivalencia SQL/reducer, concurrencia y visual/voz/captions reales |
| Lote/recuperación compartida | command session/controller, NarrativeEditorController, único journal/key/Web Lock; Host discrimina pointer; Native verifica IDs si hash coincide y conserva revisión posterior | Storage/Web Locks entre pestañas, cambio de tenant, pérdida de ACK y remount reales |
| Bloque 5: corpus/observabilidad/rollout | recetas narrativa en corpus de medios existente, compiler preview/render y checkpoints/mix existentes; HTTP correlation ID/logs/no-store; flags piloto y rollback separados | Captura preview/MP4 y reporte por mecanismos existentes, sin otro gate |

Las suites técnicas cubren casos puros, contratos y adaptadores simulados. No confundir este inventario con ejecución SQL ni certificación de browser/render.

## 3. Comandos técnicos reproducibles

Desde `D:\Pulse Hub\courseforge\apps\web`:

```powershell
npx tsc -p tsconfig.hyperframes-test.json
$narrativeTestPaths = @(rg --files .tmp/hyperframes-tests/domains/production/composition-editor/__tests__ | Where-Object { $_ -match 'composition-narrative-.*\.test\.js$|composition-media-conformance-corpus\.test\.js$' })
node --test @narrativeTestPaths
npx tsc --noEmit
```

No usar verde de tests estáticos de SQL como prueba de locks/RLS/rollback. No registrar transcript, paths firmados, credenciales o PII en evidencia.

## 4. Corpus existente: cómo usar las nuevas recetas

`qa/composition-media-conformance-corpus.ts` ahora registra:

- `narrative-voice-extraction`: fuente local WAV de diez segundos; original start=1/duration=4/offset=1; copia start=8/duration=1/offset=2; canvas=9.
- `narrative-audiovisual-captions`: misma voz más texto y captions manuales. Copia de tres clips; cue recortado a 0–1 y palabra a 0–0.5 dentro del clip nuevo; original conservado.

`buildMediaConformanceCorpusCase(recipeId, fps)` devuelve documento, hash, caseSha256 y bytes/assets congelables como las recetas anteriores. FPS: 24, 25, 30, 60.
Los casos usan el planner/reducer de producción, no clips inventados a mano como sustituto de la extracción.
Las palabras del fixture son **tags sintéticos sobre tonos**, no voz humana. No subir sus registros sintéticos como aprobación de fuentes reales.

Usar `compileCompositionPreview` con INTERACTIVE_PREVIEW y HYPERFRAMES_RENDER, assets locales y documento/hash del caso; checkpoints y mezcla de referencia existentes.
La suite `composition-narrative-conformance-corpus.test.ts` comprueba ambos targets/FPS, offsets, originales y captions manuales.
Para medición perceptual, el tester debe añadir una muestra propia aprobada de voz/video, fijar hashes de bytes y usar el flujo de conformidad existente para captura y comparación. No crear un reporte PASS sin capturas/renders.

## 5. Persistencia y autorización: prerrequisito del entorno de QA

No se ejecutó ninguna migración desde esta entrega. Antes de habilitar escritores, aplicar en un entorno aislado y autorizado las migraciones con sus dependencias existentes:

1. `20261006040000_narrative_extraction_atomic_receipts.sql`.
2. `20261006100000_narrative_fragment_resource_guards.sql`.
3. `20261006110000_narrative_fragment_caption_guard.sql`.
4. `20261006120000_narrative_fragment_clip_guard.sql`.
5. `20261006130000_narrative_fragment_selection_guard.sql`.
6. `20261006140000_narrative_fragment_document_delta.sql`.
7. `20261006150000_narrative_fragment_atomic_receipts.sql`.

Comprobar parsing/aplicación PostgreSQL, search_path/privilegios y dependencias reales del append v2.
Con org/actor/draft de prueba:

- anon/authenticated sin EXECUTE ni acceso directo a receipts; service_role solo RPC scoped previsto.
- tenant/actor/componente/vínculo ajenos, recursos revocados y fuentes no READY no permiten append.
- documento/audit/receipt indivisibles; inyectar fallo tras append y verificar rollback total.
- mismo commandId/intención produce un único lote y receipt; intención distinta COMMAND_REUSED.
- dos conexiones concurrentes: locks/OCC/BUSY, cambio de checksum/font/link/duración, sin TOCTOU ni escritura parcial.
- comparación de documentos completos entre SQL y reducer, incluyendo captions vacíos/grupos/enlaces/labels/IDs y formatos legacy: discrepancia falla cerrada, no se normaliza silenciosamente.
- receipt confirma un commit histórico; no requiere revalidar recursos actuales para recuperar, pero sí acceso vigente al draft/tenant/rol.

## 6. Activación controlada y rollback

Voz: `NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY`, `NARRATIVE_EXTRACTION_ENABLED`, `NARRATIVE_EXTRACTION_ORGANIZATION_IDS`, `NEXT_PUBLIC_NARRATIVE_EXTRACTION_ENABLED`.
Audiovisual: `NARRATIVE_FRAGMENT_ATOMIC_RECEIPTS_READY`, `NARRATIVE_FRAGMENT_ENABLED`, `NARRATIVE_FRAGMENT_ORGANIZATION_IDS`, `NEXT_PUBLIC_NARRATIVE_FRAGMENT_ENABLED`.

READY exige validación operativa previa del RPC correspondiente; no detecta migraciones ni certifica QA.
Enabled/READY exigen el literal `true`; allowlist debe contener UUIDs válidos. Configurar origen seguro explícito de la app según `getAppUrl`.
Flags públicos requieren el build/configuración apropiados de Next.js; UI no sustituye el gate servidor.

Rollback: apagar ENABLED y flag público de nuevas extracciones. Con READY y permisos vigentes conservar consulta de receipts, reproducción/lectura y documentos existentes; no borrar pointers/recibos/assets/historia. Eliminar organización del piloto no debe impedir recuperar un comando previo.

## 7. Checklist de aceptación del tester

- [ ] Búsqueda: vacío, repetición, Unicode combinado/emoji/RTL/ñ/acentos, texto distinto de voz, ámbito desaparecido y presupuesto excedido; cero autosaves.
- [ ] Rango: movido/trim/split/duplicado, token parcial, una palabra, límites inválidos, revisión obsoleta/replace; sin cruzar ocurrencias.
- [ ] Preescucha: end exclusivo y timeout, cambio de selección/revisión/panel, pause/seek/play existentes; sin audio elements extra.
- [ ] Voz/audiovisual: originales y assets intactos; destino append; pistas explícitas; enlaces/grupos completos; captions manuales; rechazos unsupported claros.
- [ ] Historial: un lote USER; undo/redo y recarga; checkpoint solo si reload corresponde al hash confirmado; revisión posterior nunca reemplazada por receipt.
- [ ] Recuperación: doble click, timeout/ACK perdido, reload fallido, cierre/remount, Storage lleno/corrupto y Web Locks ausente; no apply/retry automático.
- [ ] Concurrencia: dos pestañas y dos dispositivos, save queue/presets/HTML/edición pendiente; sin comandos de voz/audiovisual compitiendo ni writes parciales.
- [ ] Seguridad: permisos vigentes, cambio de org/actor, origen/JSON/límites/rate limit, sin datos internos en error/log/Storage.
- [ ] Fonts/assets: revoke/replace/hash/duración/vínculo/checksum cambian entre review/apply; conflicto sin append.
- [ ] Corpus: source offsets/duración, audio/captions/texto/visuales en ambos extremos y todos los FPS; captura/render/reporte vinculados a bytes y entorno.
- [ ] Accesibilidad/performance: foco/teclado/lector, búsqueda rápida, grandes entradas y playhead; no regresión de navegación.
- [ ] Rollback: nuevas escrituras cerradas, receipts recuperables bajo permisos actuales.

No aprobado hasta guardar resultados reales de estos puntos. Implementación completa no significa autorización de producción.
