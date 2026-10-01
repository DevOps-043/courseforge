# Investigación estratégica del editor multimedia de SofLIA Engine / Courseforge

Fecha de corte: **2026-09-26** · Commit: `702e7d34000fe0957c2ba8d37f1f9137def58150` · Rama: `main`

Artefactos auditables:

1. [Auditoría local e inventario](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_LOCAL_AUDIT.md)
2. [Benchmark, gap analysis y fuentes](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_BENCHMARK.md)
3. [Arquitectura, operaciones, seguridad y roadmap](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md)

## Conclusiones accionables

1. **No reescribir el editor.** El documento declarativo Courseforge, sus operaciones Zod, OCC, snapshots y compilación HyperFrames constituyen una base correcta y diferenciadora.
2. **Cerrar correctitud antes de sumar efectos.** Undo/redo general, autosave recuperable, suite global verde y conformidad preview/render son P0.
3. **La capacidad actual es significativa pero desigual.** Timeline, transform, texto, captions, audio base, motion, transiciones, presets y render existen; waveform, loudness, ripple completo, copy/paste, proxies y HTML editable no.
4. **Preview incremental y color aún no son GA.** El primero permanece en rollout DEV y su smoke de Chromium falló en este entorno; color depende de artefactos no publicados en HyperFrames `0.7.106`.
5. **HTML editable debe ser declarativo.** Componentes tipados como formato canónico, HTML instrumentado como puente y DOM arbitrario solo como entrada sanitizada; nunca `innerHTML`, JS o CSS libre como estado editable.
6. **Audio visible y medible es P1.** Waveform, peak/clipping y loudness aportan más al curso real que un catálogo amplio de efectos cinematográficos.
7. **Personas y agentes deben usar el mismo gateway.** La intención de IA se traduce a operaciones concretas, simulables, reversibles y auditables; render/publicación siguen requiriendo confirmación.
8. **WebCodecs complementa, no reemplaza, el backend.** Úsese para thumbnails/waveform/proxies acotados en Workers; el render canónico permanece HyperFrames + FFmpeg backend/cloud.
9. **No construir ahora colaboración realtime, tracking general, compositor nodal, multicam, 3D ni WebGPU baseline.** No resuelven la fricción prioritaria de producción educativa.

## 1. Resumen ejecutivo

Courseforge ya no es un simple ensamblador: posee un editor no destructivo con documentos V1–V3, 39 operaciones tipadas, timeline semántico, canvas directo parcial, inspector, motion seek-safe, transiciones con handles y crossfade, texto/captions, audio, presets, propuestas de agente, snapshots y render durable. Sin embargo, “existe código” no equivale a experiencia completa. Las mayores brechas están en recuperación de errores humanos, paridad certificada, mezcla observable, acciones masivas y edición segura de HTML.

El conjunto mínimo evolutivo es: núcleo confiable → fundamentos de edición → producción eficiente → edición avanzada selectiva → HTML declarativo → agentes. Este orden reduce riesgo y maximiza reutilización.

## 2. Alcance, supuestos y metodología

La investigación se ejecutó en tres etapas: auditoría vertical del repositorio, investigación externa oficial y síntesis. Se siguieron imports, rutas, migraciones, RPC, UI, pruebas, preview, snapshot y render. No se usaron credenciales, drafts reales ni renders pagados.

Las conclusiones externas priorizan documentación oficial de HyperFrames, Remotion, W3C/MDN, Canva, CapCut, Adobe, Blackmagic, GrapesJS, ffmpeg.wasm y Supabase. La matriz distingue Courseforge integrado de HyperFrames upstream.

Metadatos completos, comandos, navegador y limitaciones están en el [Artefacto 1](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_LOCAL_AUDIT.md#1-reproducibilidad).

## 3. Auditoría del editor actual

Capacidades `OPERATIVAS`: documento/versionado, edición temporal base, timeline/playhead, transform/crop/fit/profundidad, snapshots, transiciones, texto, captions, audio gain/fades/ducking, presets y render durable.

Capacidades `PARCIALES`: multiselección/grupos, canvas, track controls, snapping, autosave/recovery, motion avanzado, procesamiento de voz, media management, agente, paridad, accesibilidad y observabilidad.

Capacidades `EXPERIMENTALES`: preview incremental y color básico. Capacidades `AUSENTES`: undo/redo general, waveform/loudness, efectos avanzados, retime, proxies/cache editorial, HTML por elemento y colaboración realtime.

La tabla completa y la evidencia `ruta + símbolo/prueba + commit` están en el [inventario local](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_LOCAL_AUDIT.md#5-inventario-y-estado-agregado).

## 4. Benchmark de productos

Los editores web demuestran que timeline, captions, keyframes y manipulación directa son viables, mientras Premiere/Resolve muestran semánticas maduras de trim, curves y audio. No se recomienda copiar su amplitud: Courseforge debe seleccionar capacidades frecuentes en cursos.

HyperFrames aporta render HTML seek-driven y Remotion valida el principio de payload serializable compartido entre Player/render. GrapesJS demuestra el valor de un modelo de componentes separado de la vista, relevante para HTML editable.

La [Matriz A](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_BENCHMARK.md#4-matriz-a--benchmark-normalizado) conserva `No verificada` cuando el acceso o la fuente no bastan.

## 5. Catálogo maestro de capacidades

El catálogo estable usa `CAP-001..032` en todos los artefactos. La prioridad recomendada:

- P0: CAP-009 undo/redo, CAP-010 recovery, CAP-026 preview productivo, CAP-027 paridad.
- P1: CAP-003 ripple/insert, CAP-004 acciones masivas, CAP-008 guías/safe areas, CAP-017 waveform/loudness, CAP-023 replace/media bin, CAP-029 HTML editable después del núcleo.
- P2: proxies/thumbnails, motion curves acotadas, audio clean-up, freeze/rate.
- P3 o no recomendada: efectos avanzados sin caso probado y colaboración realtime.

## 6. Matriz de cobertura vertical

La [Matriz C](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_LOCAL_AUDIT.md#6-matriz-c--cobertura-vertical) evalúa dominio, UI, timeline, canvas, inspector, persistencia, preview, render, pruebas, seguridad y observabilidad. Solo CAP-001/002/006/011/013–016/024/028 cumplen la mayor parte del flujo requerido; incluso allí un render cloud real no fue parte de esta ejecución.

## 7. Gap analysis

La [Matriz B](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_BENCHMARK.md#6-matriz-b--gap-analysis) usa una puntuación reproducible. La puntuación apoya el juicio: integridad, seguridad, tenancy o bloqueo de publicación pueden elevar una capacidad a P0.

La fricción principal no es falta de filtros: es no poder deshacer cualquier edición, recuperar trabajo local, confiar automáticamente en preview/render, ver el audio y reemplazar assets sin reconstruir el montaje.

## 8. Factibilidad técnica web

- Main thread: interacción, selección y operaciones pequeñas.
- Workers/WebCodecs/Mediabunny: decode/probe, thumbnails, waveform y proxies pequeños con detección runtime.
- Web Audio/AudioWorklet: mezcla interactiva y meters.
- WebGL2: efectos que realmente requieren shader; misma matemática en render.
- Backend FFmpeg: normalización, denoise calibrado, transcode y salida final.
- HyperFrames: render determinista y empaquetado canónico.

Chromium desktop es el target recomendado inicial; tablet para revisión/edición ligera y móvil para aprobación. 1080p SDR/Rec.709, 25/30 FPS y MP4/H.264/AAC forman el baseline propuesto. Son targets por validar, no soporte ya certificado.

## 9. Análisis de HTML/CSS editable

Decisión: **Modelo C declarativo como canónico + Modelo B instrumentado como puente**. El asset conserva source inmutable, template/version, manifest de editables, IDs estables, schemas, overrides, tokens y recursos internos congelados.

El iframe no usa `allow-same-origin`; si ejecuta runtime determinista usa solo `allow-scripts`. Como su origen es opaco `null`, el protocolo valida `event.source`, `MessagePort`, nonce, versión, secuencia, hash y tamaño. CSP niega red/navegación/forms/popups/downloads. Render nunca resuelve URLs arbitrarias.

Arquitectura, límites y migración: [HTML/CSS editable](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md#4-htmlcss-editable).

## 10. Modelo recomendado de operaciones

El gateway común agrega `operationId`, schema version, base hash, actor/origin, affected ranges, correlation ID e idempotencia. El evaluator puro devuelve documento candidato, inversa, diff y estrategia de preview. Los efectos externos son jobs, no falsas transacciones distribuidas.

La [Matriz D](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md#3-matriz-d--arquitectura-de-operaciones) cubre operaciones actuales y propuestas, incluidas `timeline.ripple-delete`, `asset.replace-reference` y `html.*`.

## 11. Seguridad y multi-tenancy

Controles obligatorios: RLS + `organization_id`, FK compuestas, authorization antes de service role, asset identity/checksum, signed URLs efímeras, MIME mágico y límites, sanitización, CSP/sandbox, SSRF/path traversal, operation policy, auditoría redactada, idempotencia y cuotas.

Las superficies de mayor riesgo son HTML/SVG, importadores remotos, service role, agentes y jobs de render/publicación. El [registro RISK-001..013](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md#5-seguridad-y-multi-tenancy) define mitigaciones.

## 12. Rendimiento y observabilidad

No se inventaron benchmarks actuales. Se proponen presupuestos: operación p95 ≤16 ms a 150 clips, live ACK ≤50 ms, save p95 ≤800 ms, documento warning 2 MiB/hard 5 MiB, 4 decoders simultáneos objetivo y UX certificada inicial 150 clips/12 tracks, aunque el schema admite 500/32.

Waveforms y thumbnails usan LOD/content-addressing; jobs aplican backpressure, cancelación y dedupe. El contrato de paridad fija hashes, fixtures, timecodes, SSIM/pixel diff, tolerancia de 1 frame, sync ≤20 ms y loudness/true peak. Véase [contrato y presupuestos](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md#6-contrato-medible-de-paridad).

## 13. Roadmap priorizado

1. **Fase 0 (`L`)**: gates, gateway, undo/redo, autosave/recovery, parity harness, observabilidad.
2. **Fase 1 (`L`)**: ripple/insert, duplicate/copy, acciones masivas, guías, shortcuts y canvas multiselección.
3. **Fase 2 (`L`)**: waveform/loudness, media bin/replace, thumbnails/proxies medidos y workflows de marca/captions.
4. **Fase 3 (`M/L` por bloque)**: curves, paths simples, freeze/rate, masks/chroma condicionados y subcomposiciones.
5. **Fase 4 (`XL`)**: HTML asset/manifests/overrides/sandbox/inspector/migración.
6. **Fase 5 (`M`)**: catálogo completo y agentes sobre operaciones humanas maduras.

Cada fase incluye dependencias, datos, riesgos, tests, aceptación, métricas, rollout y rollback en el [roadmap detallado](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md#8-roadmap-incremental).

## 14. Riesgos y decisiones pendientes

Los bloqueadores inmediatos son: suite HyperFrames global rota por alias, smoke Chromium incompleto, color upstream no publicado y ausencia de paridad cloud automatizada. No se debe promover preview/color ni iniciar HTML editable productivo sin resolverlos.

El [registro DEC-101..108](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md#9-registro-de-decisiones-pendientes) asigna responsable sugerido y condición de revisión para session store, proxies, loudness, HTML overrides, browsers, colaboración, color y WebGPU.

## 15. Fuentes

El [ledger externo SRC-E01..E25](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_BENCHMARK.md#2-ledger-de-fuentes-externas) registra producto, capacidad, URL, estado y confianza. El [ledger local SRC-L01..L22](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_LOCAL_AUDIT.md#3-ledger-de-evidencia-local) registra rutas, símbolos/pruebas y el commit auditado.

## Listas finales

### Construir ahora

- Gates y paridad; undo/redo; autosave/recovery.
- Ripple/insert, duplicate y acciones masivas.
- Waveform/loudness y replacement de assets.

### Investigar o prototipar

- HTML declarativo/instrumentado y sandbox.
- Proxies/WebCodecs, curvas acotadas, freeze/rate y chroma por demanda.
- Matriz Safari/Firefox y límites reales de hardware.

### No construir por ahora

- Realtime CRDT, tracking/estabilización general, compositor nodal, multicam, 3D y WebGPU baseline.
- JS/CSS/HTML arbitrario, plugins no confiables o reemplazo de la fuente de verdad por HyperFrames Studio.
