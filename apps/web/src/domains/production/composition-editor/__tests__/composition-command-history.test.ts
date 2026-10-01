import assert from "node:assert/strict";
import test from "node:test";
import { CompositionCommandHistory } from "../composition-command-history";
import { createTransitionDocument } from "./composition-transition-test-fixtures";

test("moves a committed command between undo and redo without creating recursive entries", () => {
  const history = new CompositionCommandHistory();
  const before = createTransitionDocument();
  const after = structuredClone(before);
  after.variables.title = "Título editado";

  assert.equal(history.record({ afterDocument: after, beforeDocument: before, source: "USER", summary: "Cambió el título." }), true);
  assert.equal(history.snapshot().canUndo, true);
  const undo = history.peekUndo();
  assert.equal(undo?.beforeDocument.variables.title, before.variables.title);
  assert.equal(history.commitUndo(undo!.id), true);
  assert.deepEqual(history.snapshot(), {
    canRedo: true,
    canUndo: false,
    redoLabel: "Cambió el título.",
    retainedEntries: 1,
    retainedSerializedBytes: undo!.serializedBytes,
    undoLabel: null,
  });

  const redo = history.peekRedo();
  assert.equal(redo?.afterDocument.variables.title, "Título editado");
  assert.equal(history.commitRedo(redo!.id), true);
  assert.equal(history.snapshot().canUndo, true);
});

test("a new edit clears redo and the memory budget evicts the oldest command", () => {
  const document = createTransitionDocument();
  const serializedBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength * 2;
  const history = new CompositionCommandHistory({ maxEntries: 10, maxSerializedBytes: serializedBytes * 2 + 128 });
  for (const title of ["Uno", "Dos", "Tres"]) {
    const after = structuredClone(document);
    after.variables.title = title;
    history.record({ afterDocument: after, beforeDocument: document, source: "USER", summary: title });
  }
  assert.equal(history.snapshot().retainedEntries, 2);
  const latest = history.peekUndo();
  history.commitUndo(latest!.id);
  assert.equal(history.snapshot().canRedo, true);
  const replacement = structuredClone(document);
  replacement.variables.title = "Reemplazo";
  history.record({ afterDocument: replacement, beforeDocument: document, source: "USER", summary: "Reemplazo" });
  assert.equal(history.snapshot().canRedo, false);
});

test("does not retain no-op or oversized commands", () => {
  const document = createTransitionDocument();
  const history = new CompositionCommandHistory({ maxSerializedBytes: 100 });
  assert.equal(history.record({ afterDocument: document, beforeDocument: document, source: "USER", summary: "Sin cambio" }), false);
  const changed = structuredClone(document);
  changed.variables.title = "Cambio";
  assert.equal(history.record({ afterDocument: changed, beforeDocument: document, source: "USER", summary: "Cambio" }), false);
  assert.equal(history.snapshot().retainedEntries, 0);
});
