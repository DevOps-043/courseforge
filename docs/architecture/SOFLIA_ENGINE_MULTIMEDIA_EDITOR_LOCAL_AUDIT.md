# Auditoría local del editor multimedia de SofLIA Engine

> Artefacto 1 de la investigación estratégica. Corte: **2026-09-26**.

## 1. Reproducibilidad

| Campo                         | Valor                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Commit auditado               | `702e7d34000fe0957c2ba8d37f1f9137def58150`                                                  |
| Commit date                   | 2026-09-25 14:37:49 -0600                                                                   |
| Rama                          | `main`                                                                                      |
| Working tree inicial          | Con cambios: solo `?? docs/architecture/SOFLIA_ENGINE_MULTIMEDIA_EDITOR_RESEARCH_PROMPT.md` |
| Runtime                       | Node `v24.19.0`, npm `11.19.0`                                                              |
| Framework                     | Next `16.1.3`, React `19.2.3`, TypeScript `5.9.3`, Zod `4.4.3`                              |
| Render                        | HyperFrames `0.7.106` exacto; Remotion `4.0.484` exacto; GSAP `3.15.0`                      |
| Media                         | Mediabunny `1.47.0`, Sharp `0.35.4`; FFmpeg nativo previsto por worker backend              |
| Sistema                       | Windows; la consulta WMI de edición/versión fue denegada por el entorno                     |
| Navegadores detectados        | Chrome `153.0.8010.53`; Edge `154.0.4258.37`                                                |
| Inspección manual autenticada | No ejecutada; no se usaron credenciales ni un draft real                                    |
| Render cloud/pagado           | No ejecutado                                                                                |

### Comandos y resultados

- `git rev-parse HEAD`, `git branch --show-current`, `git status --porcelain=v1`: ejecutados.
- Inventario con `rg --files` y seguimiento de imports/rutas/migraciones/pruebas: ejecutado.
- `npm run test:composition-timeline --workspace=apps/web`: **19/19 aprobadas**.
- `npm run test:composition-transitions --workspace=apps/web`: **23/23 aprobadas**.
- `npm run test:composition-preview-sync --workspace=apps/web`: **28/28 aprobadas**.
- `npm run test:audio-processing --workspace=apps/web`: **8/8 aprobadas**.
- `npm run test:hyperframes --workspace=apps/web`: compiló y aprobó los bloques anteriores al test de modelo de agente, pero **falló** al resolver el alias `@/lib/server/outbound-http` desde el JS compilado. Es un defecto reproducible del harness o del mapeo de módulos; la suite completa no puede declararse aprobada.
- `npm run qa:composition-preview-runtime --workspace=apps/web`: generó fixtures válidos, pero **falló** porque Chromium no expuso `DevToolsActivePort` dentro del timeout. La verificación visual real queda `NO_VERIFICADA`.

No se ejecutaron build de producción, migraciones remotas, pruebas con Supabase real, render HyperFrames Cloud ni publicación. Esos límites impiden convertir evidencia estática o unitaria en garantía operacional.

## 2. Alcance y método

Se inspeccionaron el dominio `composition-editor`, sus componentes React, rutas de producción, persistencia SQL/RPC, snapshot/render, assets, audio processing, documentación y pruebas. Para cada capacidad se exigió evidencia separada en dominio, UI, timeline, canvas/inspector, persistencia, preview, render, pruebas, seguridad y observabilidad.

Convenciones:

- `SRC-L*`: evidencia local en el commit auditado.
- `CAP-*`: capacidad estable entre los cuatro artefactos.
- `VERIFICADA`: código más prueba o inspección suficiente en esa capa.
- `PRESENTE_NO_VERIFICADA`: existe código, pero no se ejecutó de forma suficiente.
- `PARCIAL`: solo una parte del comportamiento requerido.
- `AUSENTE`: búsqueda razonable sin implementación relevante.
- `NO_VERIFICADA`: acceso o evidencia insuficiente.
- `NO_APLICA`: la capa no corresponde.

## 3. Ledger de evidencia local

Todas las entradas refieren al commit `702e7d34000fe0957c2ba8d37f1f9137def58150`.

| SRC-ID  | Ruta y símbolo/prueba                                                                   | Evidencia                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SRC-L01 | `composition-document.types.ts` — `compositionEditorDocumentSchema`                     | Documento V1/V2/V3, 500 clips, 32 tracks, 250 grupos, 600 s, 24/25/30/60 FPS e invariantes referenciales.                                                                                                                                  |
| SRC-L02 | `editor-patch.types.ts` — `compositionEditorPatchOperationSchema`                       | 39 operaciones estrictas; batch de 1..100; origen `USER` o `AGENT`.                                                                                                                                                                        |
| SRC-L03 | `editor-patch.service.ts` — `applyCompositionEditorPatches`                             | Aplicación determinista, locks, validación final, split/remove-range, groups, motion, transiciones, texto y audio.                                                                                                                         |
| SRC-L04 | `CompositionTimeline.tsx` — `CompositionTimeline`                                       | Multiselección, drag/trim, zoom, scroll, ruler/playhead, snap, grupos, marcadores de transición y controles de pista.                                                                                                                      |
| SRC-L05 | `NativeCompositionPreview.tsx` y `CompositionInspector.tsx`                             | Selección canvas, mover/redimensionar, crop, fit, transform, profundidad, texto, color, motion y audio.                                                                                                                                    |
| SRC-L06 | `composition-preview-compiler.service.ts` — `compileCompositionPreview`                 | Compilación HTML determinista de clips, audio, motion, captions y transiciones.                                                                                                                                                            |
| SRC-L07 | `composition-preview-protocol.ts` y `composition-preview-runtime-sync.client.ts`        | Protocolo versionado, schema, `event.source`, ACK correlacionado y límites de payload/tiempo.                                                                                                                                              |
| SRC-L08 | `composition-preview-operation-policy.ts` y `composition-preview-visual-patch.ts`       | Clasificación `LIVE_DOM` frente a recompilación; patches visuales allow-listed.                                                                                                                                                            |
| SRC-L09 | `composition-document.service.ts` — append/get/current                                  | OCC por hash, append de versión, scope por organización, assets enlazados y errores correlacionados.                                                                                                                                       |
| SRC-L10 | ruta `drafts/[draftId]/document/route.ts` — `authorize`/`PUT`                           | Auth, tenant, rol `canReviewContent`, `If-Match`, errores tipados y logging.                                                                                                                                                               |
| SRC-L11 | migraciones `20260812180000_*`, `20260829130000_*` y composición/agente/presets         | RLS, versiones append-only, snapshots/restauración, propuestas y operaciones auditables.                                                                                                                                                   |
| SRC-L12 | `composition-snapshot.service.ts`                                                       | Snapshot inmutable, manifest, hashes, fuentes/assets locales y materialización para render.                                                                                                                                                |
| SRC-L13 | `composition-motion-*.ts` y pruebas                                                     | Motion V2, presets, keyframes finitos, scheduling y runtime seek-safe.                                                                                                                                                                     |
| SRC-L14 | `composition-transition-*.ts`, `TransitionControls.tsx` y pruebas                       | Transiciones reales, handles, crossfade, timeline, persistencia y contrato cloud.                                                                                                                                                          |
| SRC-L15 | `composition-text-layer.types.ts`, servicios caption y `CompositionTextControls.tsx`    | Texto/captions nativos, SRT/VTT, cues, presets y fuentes organizacionales.                                                                                                                                                                 |
| SRC-L16 | `composition-audio-mix.service.ts`, `AudioMixControls.tsx` y `TrackControls.tsx`        | Volumen de clip/track, mute, ducking y fades; no waveform/solo/pan/EQ interactivo.                                                                                                                                                         |
| SRC-L17 | `audio-processing/*` y sus pruebas                                                      | Jobs backend con perfiles allow-listed y comandos FFmpeg sin interpolación shell.                                                                                                                                                          |
| SRC-L18 | `composition-agent-*.ts` y rutas `agent-proposals`                                      | Read tools, schema, simulación, diff, riesgo, propuesta, persistencia, apply y undo acotado.                                                                                                                                               |
| SRC-L19 | `composition-preset-*.ts` y `CompositionPresetPanel.tsx`                                | Presets versionados, preview, aplicación, undo y catálogos por organización.                                                                                                                                                               |
| SRC-L20 | `CompositionDeliveryPanel.tsx`, rutas `renders`, diagnósticos y cancelación             | Snapshot aprobado, perfil fijo, preflight, idempotencia, polling/import, diagnóstico y cancelación.                                                                                                                                        |
| SRC-L21 | suites ejecutadas en esta auditoría                                                     | Timeline/transiciones/preview-sync/audio aprobadas; suite global y smoke visual con limitaciones descritas.                                                                                                                                |
| SRC-L22 | búsquedas negativas con `rg` en dominio y UI                                            | No se halló waveform, slip, roll, overwrite, clipboard/paste, autosave general, loudness, blend modes o velocidad/reverse.                                                                                                                 |
| SRC-L23 | rutas `drafts/[draftId]/preview`, `revisions/[revisionId]/preview` y iframes de preview | El iframe usa `sandbox="allow-scripts"` sin same-origin y valida `event.source`; la CSP actual aún permite scripts/estilos inline y recursos `https:` amplios, aceptable solo para el pipeline controlado actual, no para HTML arbitrario. |

## 4. Decisiones previas

| DEC-ID  | Documento                                                | Estado                        | Evidencia y ajuste                                                                                                                                                                     |
| ------- | -------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-001 | `adr-composition-motion-source-of-truth.md`              | `CONFIRMADA_POR_LA_AUDITORÍA` | Motion vive en `document.motion`, no en HTML mutable; schema, operaciones, compilador y pruebas lo confirman (SRC-L01/L02/L06/L13).                                                    |
| DEC-002 | `composition-motion-v1.md`                               | `REQUIERE_ACTUALIZACIÓN`      | La decisión base sigue vigente, pero el runtime ya usa schema V2 y presets ambientales finitos; el título V1 oculta esa evolución.                                                     |
| DEC-003 | `composition-transitions-v1.md`                          | `CONFIRMADA_POR_LA_AUDITORÍA` | Las fases 0–7 tienen dominio, UI, persistencia, preview/render y pruebas focalizadas aprobadas (SRC-L14/L21). Falta render cloud real.                                                 |
| DEC-004 | `native-text-captions-and-fonts.md`                      | `CONFIRMADA_POR_LA_AUDITORÍA` | V3, UI, cues, presets y empaquetado de fuentes existen. Normalización WOFF/WOFF2 continúa pendiente (SRC-L15).                                                                         |
| DEC-005 | `basic-color-correction-v1.md`                           | `VIGENTE`                     | Contrato/UI/runtime local existen, pero `@hyperframes/core@0.7.106` no publica aún los artefactos requeridos. Debe permanecer experimental y bloqueado para rollout.                   |
| DEC-006 | `SOFLIA_ENGINE_EDITABLE_PREVIEW_RESEARCH.md`             | `REQUIERE_ACTUALIZACIÓN`      | Se implementaron protocolo, live patches y save queue que resuelven parte de sus P0; el rollout continúa limitado a DEV y el smoke de esta auditoría no se completó (SRC-L07/L08/L21). |
| DEC-007 | `COMPOSITION_PREVIEW_DEV_ROLLOUT.md`                     | `VIGENTE`                     | Los gates unitarios pasan; la matriz autenticada y el runtime smoke siguen sin certificación. No promover a QA/PROD.                                                                   |
| DEC-008 | `hyperframes-composition-render-flow-source-of-truth.md` | `REQUIERE_ACTUALIZACIÓN`      | La corrección SFX aparece implementada y probada; debe aclararse el estado real de despliegue de la migración y registrar el fallo actual del harness global.                          |

Ninguna decisión se clasifica como `SUPERADA`: la arquitectura incremental del documento declarativo continúa siendo coherente.

## 5. Inventario y estado agregado

| CAP-ID  | Capacidad                             | Estado         | Diagnóstico                                                                                                   |
| ------- | ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| CAP-001 | Documento declarativo versionado      | `OPERATIVA`    | Schema estricto, hashes, append OCC, migración compatible y snapshots.                                        |
| CAP-002 | Move/trim/duración/split/remove-range | `OPERATIVA`    | Operaciones y pruebas; split y remove-range preservan invariantes.                                            |
| CAP-003 | Timeline multipista y playhead        | `OPERATIVA`    | UI, teclado por frame, zoom/scroll/snap y selección sincronizada.                                             |
| CAP-004 | Multiselección y grupos               | `PARCIAL`      | Selección/grupos/move existen; faltan acciones masivas consistentes, copy/paste y alineación/distribución.    |
| CAP-005 | Canvas directo                        | `PARCIAL`      | Selección, move, resize y crop; no rotación por handle, multiselección canvas, guías, reglas ni safe areas.   |
| CAP-006 | Inspector transform/crop/fit/depth    | `OPERATIVA`    | Contratos y controles completos para el alcance actual.                                                       |
| CAP-007 | Lock/visibility/mute/volume           | `PARCIAL`      | Locks, hidden, muted y gain existen; no solo ni automatización general de track.                              |
| CAP-008 | Snapping                              | `PARCIAL`      | Playhead y bordes; no grid/guías/canvas alignment ni configuración persistida.                                |
| CAP-009 | Undo/redo general                     | `AUSENTE`      | Hay undo especializado de propuestas/presets y restore de snapshot, no command stack de toda edición.         |
| CAP-010 | Autosave y crash recovery             | `PARCIAL`      | Cola serial y guardado explícito; no autosave debounced general ni recovery local de comandos no persistidos. |
| CAP-011 | Historial/snapshots/restore           | `OPERATIVA`    | Versiones inmutables, restore con OCC y revocación de aprobación.                                             |
| CAP-012 | Motion presets/keyframes              | `PARCIAL`      | Dominio/runtime/presets y edición acotada; falta editor de curvas/paths y autoría libre completa.             |
| CAP-013 | Transiciones y crossfade              | `OPERATIVA`    | E2E local y contrato cloud; render externo real no fue certificado en esta auditoría.                         |
| CAP-014 | Texto nativo                          | `OPERATIVA`    | Contenido, estilos, fuentes, timeline, preview/render.                                                        |
| CAP-015 | Captions SRT/VTT/karaoke              | `OPERATIVA`    | Import, cues, estilos y word timestamps; falta edición avanzada por palabra, no fundamental.                  |
| CAP-016 | Audio gain/fades/ducking              | `OPERATIVA`    | Documento, UI, preview/render y pruebas.                                                                      |
| CAP-017 | Waveform/metros/loudness              | `AUSENTE`      | Sin waveform, peak meters, clipping ni loudness objetivo en editor.                                           |
| CAP-018 | Procesamiento de voz backend          | `PARCIAL`      | Job/FFmpeg/perfiles seguros; denoise intencionalmente fuera hasta calibración y UI limitada.                  |
| CAP-019 | Color básico                          | `EXPERIMENTAL` | Código local completo, flag y dependencia upstream no publicada.                                              |
| CAP-020 | LUT/curvas/chroma/máscaras            | `AUSENTE`      | No hay contrato ni runtime de producto.                                                                       |
| CAP-021 | Velocidad/reverse/freeze              | `AUSENTE`      | Sin operación, UI o compilación.                                                                              |
| CAP-022 | Proxies/thumbnails/render cache       | `AUSENTE`      | Preflight y assets remotos no equivalen a proxies ni cache editorial.                                         |
| CAP-023 | Media bin/import/replace              | `PARCIAL`      | Librerías e importadores existen; búsqueda/metadata/relink/reemplazo editorial uniforme no.                   |
| CAP-024 | Presets/templates                     | `OPERATIVA`    | Preview, diff, apply, undo y tenancy.                                                                         |
| CAP-025 | Operaciones para agente               | `PARCIAL`      | Catálogo seguro y propuestas; cobertura limitada y fallo actual del harness global.                           |
| CAP-026 | Preview incremental                   | `EXPERIMENTAL` | Live DOM, ACK y fallback existen detrás de flag DEV; smoke/manual pendientes.                                 |
| CAP-027 | Paridad preview/render                | `PARCIAL`      | Compilador y payload compartidos; no hay gate sistemático de pixel/audio diff contra video final.             |
| CAP-028 | Render durable/cancelación            | `OPERATIVA`    | Snapshot, preflight, idempotencia, estados, reintentos, import y cancelación.                                 |
| CAP-029 | HTML/CSS editable por elemento        | `AUSENTE`      | Se preserva deck HTML, pero no existe manifest/overrides/selección de nodos editables.                        |
| CAP-030 | Colaboración en tiempo real           | `AUSENTE`      | OCC evita overwrite; no presencia, CRDT/OT ni merge de comandos.                                              |
| CAP-031 | Accesibilidad integral                | `PARCIAL`      | ARIA y teclado en controles clave; no auditoría WCAG completa del timeline/canvas ni reduced-motion.          |
| CAP-032 | Observabilidad editorial              | `PARCIAL`      | Métricas de preview, correlation IDs y diagnóstico de render; faltan SLOs y paridad automatizada.             |

## 6. Matriz C — cobertura vertical

Las referencias entre paréntesis aplican a todas las celdas no `NO_APLICA` de la fila salvo indicación contraria.

| CAP-ID  | Capacidad                | Dominio    | UI         | Timeline   | Canvas     | Inspector  | Persistencia | Preview                | Render                 | Pruebas    | Seguridad     | Observabilidad |
| ------- | ------------------------ | ---------- | ---------- | ---------- | ---------- | ---------- | ------------ | ---------------------- | ---------------------- | ---------- | ------------- | -------------- |
| CAP-001 | Documento versionado     | VERIFICADA | NO_APLICA  | NO_APLICA  | NO_APLICA  | NO_APLICA  | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-002 | Edición temporal base    | VERIFICADA | VERIFICADA | VERIFICADA | NO_APLICA  | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-003 | Timeline/playhead        | VERIFICADA | VERIFICADA | VERIFICADA | NO_APLICA  | NO_APLICA  | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | PARCIAL       | PARCIAL        |
| CAP-004 | Multiselección/grupos    | VERIFICADA | VERIFICADA | VERIFICADA | AUSENTE    | PARCIAL    | VERIFICADA   | VERIFICADA             | NO_APLICA              | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-005 | Canvas directo           | VERIFICADA | PARCIAL    | PARCIAL    | PARCIAL    | PARCIAL    | VERIFICADA   | PRESENTE_NO_VERIFICADA | VERIFICADA             | PARCIAL    | VERIFICADA    | PARCIAL        |
| CAP-006 | Transform/crop/fit/depth | VERIFICADA | VERIFICADA | PARCIAL    | VERIFICADA | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-007 | Track controls           | VERIFICADA | PARCIAL    | VERIFICADA | PARCIAL    | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-008 | Snapping                 | VERIFICADA | VERIFICADA | VERIFICADA | AUSENTE    | AUSENTE    | NO_APLICA    | NO_APLICA              | NO_APLICA              | VERIFICADA | NO_APLICA     | AUSENTE        |
| CAP-009 | Undo/redo general        | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | PARCIAL      | NO_APLICA              | NO_APLICA              | PARCIAL    | PARCIAL       | AUSENTE        |
| CAP-010 | Autosave/recovery        | PARCIAL    | PARCIAL    | NO_APLICA  | NO_APLICA  | NO_APLICA  | PARCIAL      | PARCIAL                | NO_APLICA              | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-011 | Historial/snapshots      | VERIFICADA | VERIFICADA | NO_APLICA  | NO_APLICA  | NO_APLICA  | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | VERIFICADA     |
| CAP-012 | Motion/keyframes         | VERIFICADA | PARCIAL    | VERIFICADA | PARCIAL    | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-013 | Transiciones             | VERIFICADA | VERIFICADA | VERIFICADA | PARCIAL    | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-014 | Texto                    | VERIFICADA | VERIFICADA | VERIFICADA | PARCIAL    | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-015 | Captions                 | VERIFICADA | VERIFICADA | VERIFICADA | PARCIAL    | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-016 | Audio mix base           | VERIFICADA | VERIFICADA | PARCIAL    | NO_APLICA  | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-017 | Waveform/loudness        | AUSENTE    | AUSENTE    | AUSENTE    | NO_APLICA  | AUSENTE    | AUSENTE      | AUSENTE                | AUSENTE                | AUSENTE    | NO_APLICA     | AUSENTE        |
| CAP-018 | Audio processing         | VERIFICADA | PARCIAL    | NO_APLICA  | NO_APLICA  | PARCIAL    | VERIFICADA   | PARCIAL                | VERIFICADA             | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-019 | Color básico             | VERIFICADA | VERIFICADA | NO_APLICA  | PARCIAL    | VERIFICADA | VERIFICADA   | PRESENTE_NO_VERIFICADA | PRESENTE_NO_VERIFICADA | VERIFICADA | VERIFICADA    | PARCIAL        |
| CAP-020 | Efectos avanzados        | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE      | AUSENTE                | AUSENTE                | AUSENTE    | NO_VERIFICADA | AUSENTE        |
| CAP-021 | Retime                   | AUSENTE    | AUSENTE    | AUSENTE    | NO_APLICA  | AUSENTE    | AUSENTE      | AUSENTE                | AUSENTE                | AUSENTE    | NO_APLICA     | AUSENTE        |
| CAP-022 | Proxies/cache            | AUSENTE    | AUSENTE    | AUSENTE    | NO_APLICA  | AUSENTE    | AUSENTE      | AUSENTE                | PARCIAL                | PARCIAL    | PARCIAL       | PARCIAL        |
| CAP-023 | Media management         | PARCIAL    | PARCIAL    | PARCIAL    | NO_APLICA  | PARCIAL    | VERIFICADA   | VERIFICADA             | VERIFICADA             | PARCIAL    | VERIFICADA    | PARCIAL        |
| CAP-024 | Presets/templates        | VERIFICADA | VERIFICADA | PARCIAL    | PARCIAL    | VERIFICADA | VERIFICADA   | VERIFICADA             | VERIFICADA             | VERIFICADA | VERIFICADA    | VERIFICADA     |
| CAP-025 | Agente                   | VERIFICADA | VERIFICADA | NO_APLICA  | NO_APLICA  | NO_APLICA  | VERIFICADA   | VERIFICADA             | VERIFICADA             | PARCIAL    | VERIFICADA    | VERIFICADA     |
| CAP-026 | Preview incremental      | VERIFICADA | VERIFICADA | VERIFICADA | VERIFICADA | VERIFICADA | PARCIAL      | PRESENTE_NO_VERIFICADA | NO_APLICA              | PARCIAL    | VERIFICADA    | VERIFICADA     |
| CAP-027 | Paridad                  | PARCIAL    | PARCIAL    | NO_APLICA  | NO_APLICA  | NO_APLICA  | VERIFICADA   | PARCIAL                | PARCIAL                | PARCIAL    | VERIFICADA    | PARCIAL        |
| CAP-028 | Render durable           | VERIFICADA | VERIFICADA | NO_APLICA  | NO_APLICA  | NO_APLICA  | VERIFICADA   | NO_APLICA              | VERIFICADA             | VERIFICADA | VERIFICADA    | VERIFICADA     |
| CAP-029 | HTML editable            | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE      | PARCIAL                | PARCIAL                | AUSENTE    | PARCIAL       | AUSENTE        |
| CAP-030 | Colaboración realtime    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | AUSENTE    | PARCIAL      | NO_APLICA              | NO_APLICA              | PARCIAL    | VERIFICADA    | PARCIAL        |
| CAP-031 | Accesibilidad            | NO_APLICA  | PARCIAL    | PARCIAL    | PARCIAL    | PARCIAL    | NO_APLICA    | PARCIAL                | NO_APLICA              | AUSENTE    | NO_APLICA     | AUSENTE        |
| CAP-032 | Observabilidad           | PARCIAL    | PARCIAL    | NO_APLICA  | NO_APLICA  | NO_APLICA  | VERIFICADA   | VERIFICADA             | VERIFICADA             | PARCIAL    | VERIFICADA    | VERIFICADA     |

Evidencia: CAP-001..011 SRC-L01..L12/L21/L22; CAP-012..020 SRC-L13..L17/L21; CAP-023..028 SRC-L18..L21; CAP-029..032 SRC-L06..L12/L21/L22.

## 7. Hallazgos técnicos

### Fortalezas que deben preservarse

1. El documento declarativo, validado y versionado es una base sólida para UI, automatización y agentes.
2. OCC por hash, append inmutable, snapshots y restore limitan pérdida silenciosa.
3. Preview y render parten del mismo compilador/payload en varias áreas de alto riesgo.
4. Las operaciones no contienen selectores, scripts ni URLs arbitrarias.
5. Assets y fuentes se resuelven por identidad organizacional y se congelan en snapshots.
6. Render, importación y cancelación tienen estados e idempotencia explícitos.

### Brechas P0/P1

- `RISK-001`: no existe undo/redo general; un error humano exige restore de versión y puede revertir trabajo adicional.
- `RISK-002`: preview sync continúa experimental y no superó el smoke de navegador en este entorno.
- `RISK-003`: no existe contrato automatizado completo de paridad pixel/audio entre preview y MP4 final.
- `RISK-004`: el harness global HyperFrames está roto por resolución de alias; puede ocultar regresiones posteriores al punto de fallo.
- `RISK-005`: color grading no debe salir del flag mientras el paquete exacto upstream no publique el runtime esperado.
- `RISK-006`: HTML de deck se renderiza, pero no existe una frontera formal de campos editables ni overrides; abrir edición DOM directa ampliaría XSS/SSRF y rompería determinismo.
- `RISK-007`: ausencia de waveform, metros y loudness dificulta una mezcla educativa consistente y accesible.
- `RISK-013`: la CSP actual del preview es más amplia que la política necesaria para HTML de terceros; debe endurecerse antes de habilitar edición/importación arbitraria (SRC-L23).

## 8. Decisiones que esta etapa permite

- Mantener el documento Courseforge como única fuente editable.
- Priorizar command stack, autosave recuperable, paridad automatizada y waveform/loudness antes de herramientas cinematográficas.
- Tratar preview incremental y color como experimentales hasta certificar sus gates.
- Diseñar HTML editable mediante componentes declarativos/manifiestos, no patches arbitrarios al DOM.

No permite decidir todavía: límites reales de clips simultáneos, memoria/decoders, compatibilidad Safari/Firefox, precisión de render cloud, UX con builders reales o necesidad de colaboración simultánea.
