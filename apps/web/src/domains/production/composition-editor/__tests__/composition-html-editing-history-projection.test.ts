import test from "node:test";
import assert from "node:assert/strict";
import { CompositionCommandHistory } from "../composition-command-history";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { projectCurrentHtmlReferencesIntoHistory } from "../composition-html-editing-history-projection.client";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { createHtmlEditingRevisionFixture as fixture } from "./composition-html-editing-test-fixtures";

function setup() {
  const f = fixture();
  return { historical: f.document, current: bindHtmlEditingRevisionToComposition({ ...f.authority, document: f.document,
    revision: f.next.revision, revisionSha256: f.next.sha256 }).document };
}

test("native undo/redo checkpoints preserve their native edits but pin the confirmed HTML references", () => {
  const { historical, current } = setup(); const before = structuredClone(historical), after = structuredClone(historical);
  after.variables.title = "Native edit";
  const history = new CompositionCommandHistory(); history.record({ beforeDocument: before, afterDocument: after, source: "USER", summary: "Native title" });
  const id = history.peekUndo()!.id;
  history.rebaseDocuments(document => projectCurrentHtmlReferencesIntoHistory(document, current));
  const entry = history.peekUndo()!;
  assert.equal(entry.id, id); assert.equal(entry.afterDocument.variables.title, "Native edit");
  assert.deepEqual(entry.beforeDocument.htmlEditing, current.htmlEditing); assert.deepEqual(entry.afterDocument.htmlEditing, current.htmlEditing);
  assert.deepEqual(entry.beforeDocument.clips, before.clips); assert.equal(before.htmlEditing, undefined);
  history.commitUndo(id);
  history.rebaseDocuments(document => projectCurrentHtmlReferencesIntoHistory(document, current));
  assert.equal(history.peekRedo()!.id, id); assert.deepEqual(history.peekRedo()!.afterDocument.htmlEditing, current.htmlEditing);
});

test("replaced/missing HTML sources or unbound current documents are checkpoint barriers", () => {
  const { historical, current } = setup(); const changed = structuredClone(historical);
  const clip = changed.clips[0]!; if (clip.source.type === "DECK_SLIDE") clip.source.html += "different";
  assert.equal(projectCurrentHtmlReferencesIntoHistory(changed, current), null);
  const missing = structuredClone(historical); missing.clips.splice(0, 1);
  assert.equal(projectCurrentHtmlReferencesIntoHistory(missing, current), null);
  assert.equal(projectCurrentHtmlReferencesIntoHistory(historical, historical), null);
  const removedReference = structuredClone(current);
  const second = removedReference.clips[1]!; second.kind = "DECK_SLIDE";
  second.source = { type: "DECK_SLIDE", html: "old", slideIndex: 1, classes: "slide" };
  removedReference.htmlEditing!.items.push({ ...current.htmlEditing!.items[0]!, clipId: second.id });
  assert.doesNotThrow(() => compositionEditorDocumentSchema.parse(removedReference));
  assert.equal(projectCurrentHtmlReferencesIntoHistory(removedReference, current), null);
});

test("an incompatible checkpoint cuts the older history rather than skipping across its edit", () => {
  const { historical } = setup(); const history = new CompositionCommandHistory(); let before = historical;
  for (const title of ["one", "two", "three", "four"]) {
    const after = structuredClone(before); after.variables.title = title;
    history.record({ beforeDocument: before, afterDocument: after, source: "USER", summary: title }); before = after;
  }
  const last = history.peekUndo()!.id;
  history.rebaseDocuments(document => document.variables.title === "two" ? null : document);
  assert.equal(history.snapshot().retainedEntries, 1); assert.equal(history.peekUndo()!.id, last);
});

test("rebase enforces the serialized budget even when all entries are in redo", () => {
  const { historical } = setup(); const after = structuredClone(historical); after.variables.title = "small";
  const bytes = new TextEncoder().encode(JSON.stringify(historical) + JSON.stringify(after)).byteLength;
  const history = new CompositionCommandHistory({ maxSerializedBytes: bytes + 100 });
  history.record({ beforeDocument: historical, afterDocument: after, source: "USER", summary: "small" });
  history.commitUndo(history.peekUndo()!.id);
  history.rebaseDocuments(document => { document.variables.title = "x".repeat(4096); return document; });
  assert.equal(history.snapshot().retainedEntries, 0); assert.equal(history.snapshot().retainedSerializedBytes, 0);
});

test("a throwing projection cannot partially change either history stack", () => {
  const { historical } = setup(); const history = new CompositionCommandHistory(); let before = historical;
  for (const title of ["one", "two"]) {
    const after = structuredClone(before); after.variables.title = title;
    history.record({ beforeDocument: before, afterDocument: after, source: "USER", summary: title }); before = after;
  }
  history.commitUndo(history.peekUndo()!.id);
  const undo = structuredClone(history.peekUndo()), redo = structuredClone(history.peekRedo()); let calls = 0;
  assert.throws(() => history.rebaseDocuments(document => {
    if (++calls === 3) throw new Error("projection"); document.variables.title = "rebased"; return document;
  }), /projection/);
  assert.deepEqual(history.peekUndo(), undo); assert.deepEqual(history.peekRedo(), redo);
});
