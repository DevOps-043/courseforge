import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildCompositionClipExportPlan, COMPOSITION_CLIP_EXPORT_POLICY } from "../composition-clip-export-plan";
import { prepareClipExportSource, readClipExportSource } from "../composition-clip-export-io.client";
import { CompositionLocalEdits } from "../composition-local-edits";
import { CompositionSaveQueue } from "../composition-save-queue";
import type { CompositionClip } from "../composition-document.types";

function fixture() {
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{
    checksum: "a".repeat(64), durationSeconds: 10, fileSizeBytes: 42, hasAudio: true,
    mimeType: "video/mp4", productionAssetId: "11111111-1111-4111-8111-111111111111",
    publicUrl: null, storageBucket: "production-assets", storagePath: "fixture.mp4", timelineRole: "BROLL",
  }], plan: { accentColor: "#38BDF8", durationSeconds: 20, subtitle: "", title: "Recorte" } });
  document.canvas.durationSeconds = 20;
  return document;
}

for (const [label, start, end, expected] of [
  ["inicio", 0, 2, [[2, 10]]],
  ["centro", 3, 6, [[0, 3], [6, 10]]],
  ["final", 7, 10, [[0, 7]]],
] as const) test(`exporta ventanas fuente correctas tras eliminar el ${label}`, () => {
  const document = fixture();
  const original = document.clips[0];
  original.startSeconds = 4;
  const edited = applyCompositionEditorPatches(document, [{ type: "clip.remove-range", clipId: original.id,
    startSeconds: 4 + start, endSeconds: 4 + end, ripple: true, newClipId: "right", newHfId: "right-hf" }]);
  assert.deepEqual(edited.clips.map(clip => {
    const plan = buildCompositionClipExportPlan(clip);
    assert.equal(plan.mimeType, "video/mp4");
    return [plan.start, plan.end];
  }), expected);
  assert.equal(document.clips[0].durationSeconds, 10, "el asset y documento fuente permanecen intactos");
});

test("exporta el offset acumulado tras recortes sucesivos", () => {
  const document = fixture();
  const clip = document.clips[0];
  clip.sourceOffsetSeconds = 2; clip.durationSeconds = 6;
  const edited = applyCompositionEditorPatches(document, [{ type: "clip.remove-range", clipId: clip.id,
    startSeconds: clip.startSeconds, endSeconds: clip.startSeconds + 1, ripple: true }]);
  const plan = buildCompositionClipExportPlan(edited.clips[0]);
  assert.deepEqual([plan.start, plan.end], [3, 8]);
});

test("la descarga espera la confirmación del recorte local y captura sus offsets vigentes", async () => {
  const initial = { document: fixture(), documentHash: "a".repeat(64) };
  const edits = new CompositionLocalEdits<typeof initial>();
  const clip = initial.document.clips[0];
  const admitted = edits.admit(initial, { id: "cut", source: "USER", operations: [
    { type: "clip.remove-range", clipId: clip.id, startSeconds: 0, endSeconds: 2, ripple: true },
  ] })!;
  let current = admitted.payload;
  let releaseSave!: () => void;
  const saveReleased = new Promise<void>(resolve => { releaseSave = resolve; });
  const queue = new CompositionSaveQueue<() => Promise<boolean>>(command => command());
  const saved = queue.enqueue(async () => {
    await saveReleased;
    const prepared = edits.prepare("cut");
    current = edits.confirm("cut", { document: prepared.document, documentHash: "b".repeat(64) });
    return true;
  });
  let reads = 0;
  const download = prepareClipExportSource({ flush: async () => true, waitForIdle: () => queue.whenIdle(),
    readCurrentSource: () => { reads++; return { clip: current.document.clips[0], sourceUrl: "/medio", hasPendingChanges: edits.active }; },
  });
  await Promise.resolve();
  assert.equal(reads, 0, "No se obtiene una fuente antes de confirmar la cola.");
  releaseSave();
  const source = await download;
  assert.equal(await saved, true);
  const plan = buildCompositionClipExportPlan(source.clip);
  assert.deepEqual([plan.start, plan.end], [2, 10]);
  assert.notEqual(source.clip, current.document.clips[0], "La exportación conserva su copia del clip confirmado.");
});

test("una cola vacía tras fallar el guardado no permite descargar la proyección sin confirmar", async () => {
  const initial = { document: fixture(), documentHash: "a".repeat(64) };
  const edits = new CompositionLocalEdits<typeof initial>();
  const clip = initial.document.clips[0];
  const admitted = edits.admit(initial, { id: "cut", source: "USER", operations: [
    { type: "clip.remove-range", clipId: clip.id, startSeconds: 0, endSeconds: 2, ripple: true },
  ] })!;
  const queue = new CompositionSaveQueue<() => Promise<boolean>>(command => command());
  await queue.enqueue(async () => false);
  assert.equal(queue.snapshot().status, "IDLE");
  await assert.rejects(prepareClipExportSource({ flush: async () => true, waitForIdle: () => queue.whenIdle(),
    readCurrentSource: () => ({ clip: admitted.payload.document.clips[0], sourceUrl: "/medio", hasPendingChanges: edits.active }),
  }), /recuperación/);
});

test("un residual menor al mínimo no genera una identidad seleccionable inexistente", () => {
  const document = fixture();
  const clip = document.clips[0];
  const edited = applyCompositionEditorPatches(document, [{ type: "clip.remove-range", clipId: clip.id,
    startSeconds: 3, endSeconds: 10 - 1 / 30, ripple: true, newClipId: "right", newHfId: "right-hf" }]);
  assert.equal(edited.clips.length, 1);
  assert.equal(edited.clips[0].id, clip.id);
  assert.equal(buildCompositionClipExportPlan(edited.clips[0]).end, 3);
});

test("eliminar el clip completo no ofrece un fragmento exportable", () => {
  const document = fixture();
  document.clips.push({ ...structuredClone(document.clips[0]), id: "other", hfId: "other-hf", startSeconds: 10 });
  const edited = applyCompositionEditorPatches(document, [{ type: "clip.remove-range", clipId: document.clips[0].id,
    startSeconds: 0, endSeconds: 10, ripple: true }]);
  assert.equal(edited.clips.length, 1);
  assert.equal(edited.clips[0].id, "other");
});

test("audio usa WAV y rechaza velocidad, congelación, bucles y duración excesiva", () => {
  const clip = fixture().clips[0];
  assert.equal(buildCompositionClipExportPlan({ ...clip, kind: "AUDIO" }).mimeType, "audio/wav");
  const invalidChanges: Partial<CompositionClip>[] = [{ playbackRate: 2 }, { freezeTailSeconds: 1 }, { durationSeconds: 11 },
    { sourceOffsetSeconds: -1 }, { durationSeconds: 601 }, { durationSeconds: Number.NaN }];
  for (const change of invalidChanges) {
    assert.throws(() => buildCompositionClipExportPlan({ ...clip, ...change }));
  }
  assert.throws(() => buildCompositionClipExportPlan({ ...clip, kind: "IMAGE" }));
});

test("fuente descargada: éxito, HTTP fallido, vacío, tamaño declarado y cancelación", async () => {
  const signal = new AbortController().signal;
  const blob = await readClipExportSource(new Response(new Uint8Array([1, 2, 3])), signal);
  assert.equal(blob.size, 3);
  await assert.rejects(readClipExportSource(new Response(null, { status: 403 }), signal), /Renueva/);
  await assert.rejects(readClipExportSource(new Response(new Uint8Array()), signal), /vacío/);
  await assert.rejects(readClipExportSource(new Response(new Uint8Array([1]), {
    headers: { "content-length": String(COMPOSITION_CLIP_EXPORT_POLICY.maximumBytes + 1) },
  }), signal), /256 MiB/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(readClipExportSource(new Response(new Uint8Array([1])), cancelled.signal), { name: "AbortError" });
});

test("el tamaño real limita respuestas chunked y cancela su lector", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; } }));
  await assert.rejects(readClipExportSource(response, new AbortController().signal), /256 MiB/);
  assert.equal(cancelled, true);
});
