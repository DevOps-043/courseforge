import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { acceptsCompositionPreviewShortcut, resolveCompositionEditorShortcut, renderCompositionEditorShortcutBridge } from "../composition-editor-shortcut";
import { parseCompositionPreviewIframeMessage } from "../composition-preview-protocol";

const base = { key: "z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false };
test("host admission rejects stale/baseline/unfocused/modal/preview-only/busy messages", () => {
  const valid = { currentFrame: true, messageGeneration: 2, currentGeneration: 2, ready: true, focused: true,
    modalOpen: false, previewOnly: false, saving: false };
  assert.equal(acceptsCompositionPreviewShortcut(valid), true);
  for (const override of [{ currentFrame: false }, { messageGeneration: 1 }, { ready: false }, { focused: false },
    { modalOpen: true }, { previewOnly: true }, { saving: true }]) {
    assert.equal(acceptsCompositionPreviewShortcut({ ...valid, ...override }), false);
  }
});
test("shared allowlist resolves undo/redo, clipboard, palette, duplicate and deletes", () => {
  for (const [key, expected] of [["z", "UNDO"], ["y", "REDO"], ["k", "PALETTE"], ["d", "DUPLICATE"], ["c", "COPY"], ["v", "PASTE"]]) {
    assert.equal(resolveCompositionEditorShortcut({ ...base, key }), expected);
    assert.equal(resolveCompositionEditorShortcut({ ...base, key, ctrlKey: false, metaKey: true }), expected);
  }
  assert.equal(resolveCompositionEditorShortcut({ ...base, shiftKey: true }), "REDO");
  assert.equal(resolveCompositionEditorShortcut({ ...base, key: "Delete", ctrlKey: false }), "DELETE");
  assert.equal(resolveCompositionEditorShortcut({ ...base, key: "Backspace", ctrlKey: false, shiftKey: true }), "RIPPLE_DELETE");
});
test("unhandled chords, composition and autorepeat do not dispatch mutations", () => {
  for (const override of [{ repeat: true }, { isComposing: true }, { altKey: true }, { key: "Escape" }, { key: "c", shiftKey: true }]) {
    assert.equal(resolveCompositionEditorShortcut({ ...base, ...override }), null);
  }
  assert.equal(resolveCompositionEditorShortcut({ ...base, ctrlKey: false, altKey: true, key: "ArrowLeft" }), "TIMELINE_LEFT");
  assert.equal(resolveCompositionEditorShortcut({ ...base, ctrlKey: false, key: "ArrowRight" }), null);
});
test("shortcut protocol requires generation, bounded command and no injected keyboard event", () => {
  const message = { type: "courseforge-composition-shortcut", command: "UNDO", previewGeneration: 3 };
  assert.ok(parseCompositionPreviewIframeMessage(message));
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, command: "EXECUTE_JS" }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, previewGeneration: null }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, key: "z" }), null);
});
test("serialized bridge emits only commands; edited fields, local resize and pending transactions keep ownership", () => {
  let handler: (event: any) => void = () => {};
  const messages: unknown[] = [];
  class Element {
    isContentEditable = false;
    field = false;
    control = false;
    closest(selector: string) { return selector === ".composition-editor-control" ? this.control ? this : null : this.field ? this : null; }
  }
  const target = new Element();
  const context = { root: { addEventListener: (_: string, callback: typeof handler) => { handler = callback; } },
    HTMLElement: Element, document: { hasFocus: () => true }, activeTransform: null, activeMarquee: null,
    keyboardTransform: null as null | object, postParentMessage: (message: unknown) => messages.push(message) };
  runInNewContext(renderCompositionEditorShortcutBridge(), context);
  const send = (override = {}) => handler({ ...base, target, preventDefault() {}, stopPropagation() {}, ...override });
  send(); assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), { type: "courseforge-composition-shortcut", command: "UNDO" });
  send({ repeat: true }); target.field = true; send(); target.field = false;
  target.control = true; send({ ctrlKey: false, altKey: true, key: "ArrowLeft" }); target.control = false;
  context.keyboardTransform = {}; send(); assert.equal(messages.length, 1);
  context.keyboardTransform = null; send({ defaultPrevented: true }); assert.equal(messages.length, 1);
});
