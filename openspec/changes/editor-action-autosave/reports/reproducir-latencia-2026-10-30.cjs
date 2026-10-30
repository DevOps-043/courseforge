'use strict';

// Experimento local de diagnóstico. No carga .env, no escribe al producto ni permite fetch.
// Línea base 13774405: usar --source con un checkout de esa revisión.
// Sus aserciones describen los defectos anteriores, no la corrección posterior.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { webcrypto, createHash } = require('node:crypto');

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const root = path.resolve(option('--source', process.cwd()));
const dependencies = createRequire(path.join(path.resolve(option('--dependencies', root)), 'package.json'));
const ts = dependencies('typescript');
const sourceDirectory = path.join(root, 'apps/web/src');
const domain = 'domains/production/composition-editor/';
const cache = new Map();
function loadSource(relative) {
  const requested = path.resolve(sourceDirectory, relative);
  const filename = [requested, `${requested}.ts`, `${requested}.tsx`, path.join(requested, 'index.ts')]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!filename || !filename.startsWith(sourceDirectory + path.sep)) throw new Error(`Módulo local no admitido: ${relative}`);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const requireLocal = specifier => {
    if (specifier.startsWith('.')) return loadSource(path.relative(sourceDirectory, path.resolve(path.dirname(filename), specifier)));
    if (specifier.startsWith('@/')) return loadSource(specifier.slice(2));
    return dependencies(specifier);
  };
  const emitted = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const context = { module, exports: module.exports, require: requireLocal, Buffer, URL, TextEncoder, TextDecoder,
    performance, crypto: webcrypto, structuredClone, AbortSignal, AbortController, setTimeout, clearTimeout,
    process: { env: {} }, fetch: () => { throw new Error('Este diagnóstico no permite red.'); } };
  vm.runInNewContext(emitted, context, { filename });
  return module.exports;
}

async function main() {
  const factory = loadSource(domain + 'composition-document.factory');
  const { compositionEditorDocumentSchema } = loadSource(domain + 'composition-document.types');
  const { applyCompositionEditorPatches } = loadSource(domain + 'editor-patch.service');
  const { createCompositionNativeOverlay } = loadSource(domain + 'composition-native-overlay.factory');
  const { classifyCompositionPreviewOperations } = loadSource(domain + 'composition-preview-operation-policy');
  const { buildCompositionPreviewVisualPatch } = loadSource(domain + 'composition-preview-visual-patch');
  const { buildCompositionPreviewScenePatch } = loadSource(domain + 'composition-preview-scene-patch');
  const { CompositionSaveQueue } = loadSource(domain + 'composition-save-queue');
  const { CompositionPreviewRuntimePatchCoordinator } = loadSource(domain + 'composition-preview-runtime-sync.client');
  const { CompositionPreviewTelemetryBuffer } = loadSource(domain + 'composition-preview-telemetry.client');
  const base = factory.createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: '7'.repeat(64),
    durationSeconds: 8, fileSizeBytes: 1024, hasAudio: false, mimeType: 'video/mp4',
    productionAssetId: '00000000-0000-4000-8000-000000000041', publicUrl: null,
    storageBucket: 'production-assets', storagePath: 'sintetico.mp4', timelineRole: 'BROLL' }],
    plan: { accentColor: '#38BDF8', durationSeconds: 8, subtitle: '', title: 'Diagnóstico sintético' } });
  const video = base.clips[0];
  const inspectorOperations = doc => {
    const clip = doc.clips.find(clip => clip.id === video.id);
    return [{ type: 'clip.duration', clipId: clip.id, durationSeconds: clip.durationSeconds },
      { type: 'clip.move', clipId: clip.id, startSeconds: clip.startSeconds },
      { type: 'clip.layout', clipId: clip.id, layout: { height: clip.layout.height, opacity: clip.layout.opacity,
        rotation: clip.layout.rotation, width: clip.layout.width, x: clip.layout.x + 24, y: clip.layout.y } }];
  };
  function inspect(label, before, operations) {
    const document = applyCompositionEditorPatches(before, operations, 'USER');
    const strategy = classifyCompositionPreviewOperations(operations);
    const dom = strategy === 'LIVE_DOM' ? buildCompositionPreviewVisualPatch({ document, operations }) : null;
    const scene = !dom && strategy !== 'FULL_RELOAD' ? buildCompositionPreviewScenePatch({ beforeDocument: before,
      document, assetUrls: new Map(), audioMetersEnabled: false }) : null;
    return { caso: label, operaciones: operations.map(operation => operation.type), estrategiaDeclarada: strategy,
      patchDom: Boolean(dom), patchEscena: Boolean(scene), requiereFallbackConRuntimeListo: !dom && !scene };
  }
  let deckDocument = structuredClone(base);
  deckDocument.clips.push({ ...structuredClone(video), id: 'deck-sintetico', hfId: 'deck-sintetico', kind: 'DECK_SLIDE',
    source: { type: 'DECK_SLIDE', html: '<h1>Curso sintético</h1>', slideIndex: 0, classes: 'slide active' } });
  deckDocument = compositionEditorDocumentSchema.parse(deckDocument);
  let referenceDocument = structuredClone(deckDocument);
  referenceDocument.format = 'courseforge-composition-v4';
  referenceDocument.htmlEditing = { format: 'courseforge-html-editable-references-v1', items: [{
    clipId: 'deck-sintetico', revisionVersion: 1, revisionSha256: 'a'.repeat(64), templateId: 'plantilla-sintetica',
    templateVersion: 1, sourceSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64) }] };
  referenceDocument = compositionEditorDocumentSchema.parse(referenceDocument);
  const text = createCompositionNativeOverlay({ document: referenceDocument, id: 'texto-sintetico', kind: 'TEXT', playheadSeconds: 0 });
  const withText = applyCompositionEditorPatches(referenceDocument, [{ type: 'clip.add', clipId: text.clip.id, clip: text.clip, track: text.track }]);
  const cases = [
    inspect('Movimiento mínimo por DOM, sin referencias HTML', base, [{ type: 'clip.layout', clipId: video.id, layout: { x: 24 } }]),
    inspect('Sólo posición con opacity incluida en el layout', base, [{ type: 'clip.layout', clipId: video.id, layout: { ...video.layout, x: 24 } }]),
    inspect('Lote real del inspector, sin HTML controlado', base, inspectorOperations(base)),
    inspect('Lote del inspector con deck estático sin referencias', deckDocument, inspectorOperations(deckDocument)),
    inspect('Mismo lote sobre video, con otro clip HTML controlado', referenceDocument, inspectorOperations(referenceDocument)),
    inspect('Texto nativo en composición con otro clip HTML controlado', withText,
      [{ type: 'clip.text-content', clipId: text.clip.id, text: 'Texto nuevo' }]),
  ];
  assert.equal(cases[0].patchDom, true);
  assert.equal(cases[1].patchDom, false);
  assert.equal(cases[2].patchEscena, true);
  assert.equal(cases[3].patchEscena, true);
  assert.equal(cases[4].requiereFallbackConRuntimeListo, true);
  assert.equal(cases[5].requiereFallbackConRuntimeListo, true);

  let finishSave;
  let transportSaving = false;
  let saveFinished = false;
  const queue = new CompositionSaveQueue(task => task(), state => { transportSaving = state.status === 'RUNNING' || state.pendingCount > 0; });
  const pending = queue.enqueue(async () => { await new Promise(resolve => { finishSave = resolve; }); saveFinished = true; return true; });
  const duringVisualAck = { ackVisualSimulado: true, estadoCola: queue.snapshot().status, savingGlobal: transportSaving, persistenciaTerminada: saveFinished };
  assert.equal(transportSaving, true);
  finishSave(); await pending; await queue.whenIdle();

  const coordinator = new CompositionPreviewRuntimePatchCoordinator();
  const timeoutOutcome = await coordinator.dispatch({ baseDocumentHash: 'a'.repeat(64), patch: { changes: [{ hfId: video.hfId, hidden: false }] }, send: () => true });
  assert.equal(timeoutOutcome.code, 'TIMEOUT');
  coordinator.dispose();

  const telemetry = new CompositionPreviewTelemetryBuffer({ draftId: '00000000-0000-4000-8000-000000000041',
    fetchImpl: async () => new Response('{}'), sessionId: '00000000-0000-4000-8000-000000000042' });
  let accepted = 0;
  for (let index = 0; index < 110; index++) if (telemetry.record({ name: 'save_roundtrip_ms', durationMs: 10, atSeconds: 0 })) accepted++;
  await telemetry.dispose();
  assert.equal(accepted, 100);

  const sceneCosts = [];
  for (const size of [1, 50, 200, 500]) {
    const document = structuredClone(base);
    document.clips = Array.from({ length: size }, (_, index) => ({ ...structuredClone(video), id: `clip-${index}`, hfId: `clip-${index}` }));
    compositionEditorDocumentSchema.parse(document);
    const timings = [];
    let scene;
    for (let round = 0; round < 4; round++) {
      const start = performance.now();
      scene = buildCompositionPreviewScenePatch({ beforeDocument: document, document, assetUrls: new Map(), audioMetersEnabled: false });
      if (round) timings.push(performance.now() - start);
    }
    assert.ok(scene);
    sceneCosts.push({ clips: size, nodosEnPatch: scene.nodes.length, bytesPatch: Buffer.byteLength(JSON.stringify(scene)),
      medianaConstruccionNodeMs: Number(timings.sort((a, b) => a - b)[1].toFixed(3)) });
  }
  const files = ['composition-preview-scene-patch.ts', 'composition-preview-visual-patch.ts', 'composition-save-queue.ts',
    'composition-preview-sync.config.ts', 'composition-preview-telemetry.client.ts'];
  const sourceFiles = [...files.map(file => domain + file),
    'domains/materials/components/composition-editor/NativeCompositionPreview.tsx',
    'domains/materials/components/composition-editor/CompositionInspector.tsx',
    'domains/materials/components/composition-editor/CompositionAutosaveBoundary.tsx'];
  const result = { fechaAnalisis: '2026-10-30', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    entorno: { runtime: process.version, motor: 'Node VM + TypeScript transpileModule; sin navegador ni red', flags: 'defaults del código; no se inspeccionó configuración local' },
    casos: cases, colaDuranteAckVisual: duringVisualAck,
    timeoutSinAck: { codigo: timeoutOutcome.code, duracionObservadaMs: Number(timeoutOutcome.durationMs.toFixed(2)) },
    limiteTelemetria: { intentados: 110, aceptados: accepted }, costeProyeccionSintetica: sceneCosts,
    fuentesSha256: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(sourceDirectory, file))).digest('hex')])),
    limites: ['Referencias HTML sintéticas validadas sólo como datos; no acreditan autorización ni revisión real.',
      'ACK visual simulado para observar la cola; no es un flujo completo del componente.',
      'Tiempos de construcción Node locales: no son latencia del usuario, p95 ni medición de React/DOM.',
      'El timeout omite el ACK deliberadamente; no prueba que ocurra en producción.'] };
  const output = option('--output');
  if (output) fs.writeFileSync(path.resolve(output), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
