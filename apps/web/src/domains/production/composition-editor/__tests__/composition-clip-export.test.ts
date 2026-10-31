import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildCompositionClipExportPlan, COMPOSITION_CLIP_EXPORT_POLICY } from "../composition-clip-export-plan";
import { readClipExportSource } from "../composition-clip-export-io.client";
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
