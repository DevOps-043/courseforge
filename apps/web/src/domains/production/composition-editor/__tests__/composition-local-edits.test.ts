import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { CompositionLocalEdits } from "../composition-local-edits";
import { buildCompositionInspectorPatches } from "../composition-inspector-patches";
import { buildCompositionPreviewVisualPatch } from "../composition-preview-visual-patch";
import { classifyCompositionPreviewOperations } from "../composition-preview-operation-policy";
import { CompositionInteractionAutosave } from "../composition-interaction-autosave";

function fixture() {
  return { documentHash: "a".repeat(64), document: createInitialCompositionDocument({ animatedDeck: null,
    assets: [{ checksum: "d".repeat(64), durationSeconds: 5, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "44444444-4444-4444-8444-444444444444", publicUrl: null, storageBucket: "production-assets", storagePath: "seed.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "", title: "Prueba local" },
  }) };
}

test("dos comandos se proyectan antes del PUT y la respuesta anterior conserva el último", () => {
  const initial = fixture(), edits = new CompositionLocalEdits<typeof initial>();
  const clip = initial.document.clips[0]!;
  const first = edits.admit(initial, { id: "1", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { x: 100 } }] })!;
  const prepared = edits.prepare("1");
  const second = edits.admit(first.payload, { id: "2", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { x: 200 } }] })!;
  assert.equal(second.payload.document.clips[0]!.layout.x, 200);
  assert.equal(prepared.document.clips[0]!.layout.x, 100);
  const projected = edits.confirm("1", { documentHash: "b".repeat(64), document: prepared.document }, prepared.document);
  assert.equal(projected.document.clips[0]!.layout.x, 200);
  assert.equal(edits.prepare("2").before.documentHash, "b".repeat(64));
  assert.equal(edits.prepare("2").before.document.clips[0]!.layout.x, 100, "El historial usa el anterior confirmado, no el borrador futuro.");
  assert.equal(initial.document.clips[0]!.layout.x, clip.layout.x);
  const final = edits.confirm("2", { documentHash: "c".repeat(64), document: edits.prepare("2").document });
  assert.equal(final.document.clips[0]!.layout.x, 200);
  assert.equal(edits.active, false);
});

test("una normalización confirmada por el servidor se conserva al recomponer el borrador", () => {
  const initial = fixture(), edits = new CompositionLocalEdits<typeof initial>(), clip = initial.document.clips[0]!;
  const first = edits.admit(initial, { id: "1", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { x: 100 } }] })!;
  const expected = edits.prepare("1").document;
  edits.admit(first.payload, { id: "2", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { y: 200 } }] });
  const server = structuredClone(expected);
  server.clips[0]!.label = "Etiqueta normalizada";
  const projected = edits.confirm("1", { documentHash: "b".repeat(64), document: server }, expected);
  assert.equal(projected.document.clips[0]!.label, "Etiqueta normalizada");
  assert.equal(projected.document.clips[0]!.layout.y, 200);
});

test("cancelar tras un error vuelve al confirmado y rechaza respuestas fuera de orden", () => {
  const initial = fixture(), edits = new CompositionLocalEdits<typeof initial>(), clip = initial.document.clips[0]!;
  const first = edits.admit(initial, { id: "1", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { x: 100 } }] })!;
  edits.admit(first.payload, { id: "2", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { y: 200 } }] });
  assert.throws(() => edits.confirm("2", initial), /respuesta/);
  assert.equal(edits.cancel(), initial);
  assert.equal(edits.active, false);
  assert.throws(() => edits.prepare("2"), /orden/);
});

test("sin copia recuperable no se admite ni se proyecta una edición", () => {
  const initial = fixture(), edits = new CompositionLocalEdits<typeof initial>(), clip = initial.document.clips[0]!;
  assert.throws(() => edits.admit(initial, { id: "1", source: "USER", operations: [{ type: "clip.layout", clipId: clip.id, layout: { x: 100 } }] }, () => { throw Error("cuota"); }), /cuota/);
  assert.equal(edits.active, false);
});

test("cambiar sólo X elimina timing y opacidad redundantes y conserva el patch DOM", () => {
  const initial = fixture(), clip = initial.document.clips[0]!;
  const operations = buildCompositionInspectorPatches(clip, [
    { type: "clip.duration", clipId: clip.id, durationSeconds: clip.durationSeconds },
    { type: "clip.move", clipId: clip.id, startSeconds: clip.startSeconds },
    { type: "clip.layout", clipId: clip.id, layout: { ...clip.layout, x: 100 } },
    { type: "clip.volume", clipId: clip.id, volume: 0.7 },
    { type: "clip.audio-fades", clipId: clip.id, fadeInSeconds: 0, fadeOutSeconds: 0 },
  ], 0.7);
  assert.deepEqual(operations, [{ type: "clip.layout", clipId: clip.id, layout: { x: 100 } }]);
  assert.equal(classifyCompositionPreviewOperations(operations), "LIVE_DOM");
  assert.ok(buildCompositionPreviewVisualPatch({ document: initial.document, operations }));
  assert.equal(buildCompositionInspectorPatches(clip, [{ type: "clip.layout", clipId: clip.id, layout: { ...clip.layout } }]).length, 0);
});

test("el redondeo del timecode del formulario no crea una edición de timing", () => {
  const clip = { ...fixture().document.clips[0]!, startSeconds: 1 / 30, durationSeconds: 4 + 1 / 30 };
  assert.deepEqual(buildCompositionInspectorPatches(clip, [
    { type: "clip.move", clipId: clip.id, startSeconds: 0.033 },
    { type: "clip.duration", clipId: clip.id, durationSeconds: 4.033 },
    { type: "clip.layout", clipId: clip.id, layout: { x: clip.layout.x + 10 } },
  ]), [{ type: "clip.layout", clipId: clip.id, layout: { x: clip.layout.x + 10 } }]);
});

test("volver a un valor todavía en vuelo admite otra intención y no reutiliza su respuesta", async () => {
  const session = new CompositionInteractionAutosave("0");
  const completions: Array<(value: boolean) => void> = [];
  const promises = ["1", "2", "1"].map(value => {
    session.stage(value, () => new Promise<boolean>(resolve => completions.push(resolve)));
    return session.flush();
  });
  assert.equal(completions.length, 3);
  completions[0]!(true); await promises[0]; assert.equal(session.dirty, true);
  completions[1]!(true); await promises[1]; assert.equal(session.dirty, true);
  completions[2]!(true); await promises[2]; assert.equal(session.dirty, false);
});

test("recuperar un comando confirma su interacción exacta y conserva un borrador posterior", () => {
  const session = new CompositionInteractionAutosave("original");
  session.stage("primero", () => true);
  const token = session.pendingToken!;
  session.stage("segundo", () => true);
  session.stage("primero", () => true);
  session.confirmPersisted(token);
  assert.equal(session.dirty, true, "Repetir un valor no convierte dos intenciones en el mismo comando.");
  session.confirmPersisted(session.pendingToken);
  assert.equal(session.dirty, false);
});
