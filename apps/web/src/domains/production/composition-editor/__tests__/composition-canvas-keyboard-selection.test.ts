import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext, Script } from "node:vm";
import { resolveCompositionCanvasKeyboardSelection, renderCompositionCanvasKeyboardSelection } from "../composition-canvas-keyboard-selection";
const base = { key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false,
  eligibleIds: ["a", "b", "c"], selectedIds: ["a"], focusedId: "a" };
test("plain navigation selects one candidate and respects endpoints", () => {
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection(base), { selectedIds: ["b"], focusedId: "b" });
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, key: "End" }), { selectedIds: ["c"], focusedId: "c" });
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, key: "ArrowUp" }), { selectedIds: ["a"], focusedId: "a" });
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, focusedId: null, key: "ArrowUp" }), { selectedIds: ["c"], focusedId: "c" });
});
test("Shift extends selection, Space toggles and Escape clears without document operations", () => {
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, shiftKey: true }), { selectedIds: ["a", "b"], focusedId: "b" });
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, key: " " }), { selectedIds: [], focusedId: "a" });
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, key: "Escape" }), { selectedIds: [], focusedId: null });
});
test("select all and extension retain the existing 100-id bound", () => {
  const eligibleIds = Array.from({ length: 105 }, (_, index) => `clip-${index}`);
  const result = resolveCompositionCanvasKeyboardSelection({ ...base, key: "a", ctrlKey: true, eligibleIds })!;
  assert.equal(result.selectedIds.length, 100);
  const extension = resolveCompositionCanvasKeyboardSelection({ ...base, eligibleIds, selectedIds: result.selectedIds, focusedId: "clip-99", shiftKey: true })!;
  assert.equal(extension.selectedIds.length, 100);
  assert.equal(extension.focusedId, "clip-100");
});
test("IME, Alt, native chords and Tab are not intercepted", () => {
  for (const override of [{ isComposing: true }, { altKey: true }, { ctrlKey: true }, { key: "Tab" }, { key: "Enter" }, { key: "Delete" }]) {
    assert.equal(resolveCompositionCanvasKeyboardSelection({ ...base, ...override }), null);
  }
});
test("removed and duplicate ids cannot persist into the next selection", () => {
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, eligibleIds: ["b", "b"], selectedIds: ["gone", "a"], focusedId: "gone" }), { selectedIds: ["b"], focusedId: "b" });
  assert.deepEqual(resolveCompositionCanvasKeyboardSelection({ ...base, eligibleIds: [] }), { selectedIds: [], focusedId: null });
});
test("serialized runtime installs a handler without module dependencies", () => {
  let handler: ((event: unknown) => void) | undefined;
  const attributes = new Map<string, string>();
  const runtime = renderCompositionCanvasKeyboardSelection();
  assert.doesNotThrow(() => new Script(runtime));
  runInNewContext(runtime, { root: { setAttribute: (key: string, value: string) => attributes.set(key, value), addEventListener: (_key: string, callback: typeof handler) => { handler = callback; } } });
  assert.equal(attributes.get("tabindex"), "0");
  assert.equal(attributes.get("role"), "group");
  assert.equal(typeof handler, "function");
});

test("serialized handler filters inactive peers and emits selection through existing callbacks", () => {
  class Element {
    dataset: Record<string, string>;
    isContentEditable = false;
    attributes = new Map<string, string>();
    focused = false;
    constructor(id: string) { this.dataset = { hfId: id, editorLabel: id }; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    closest(selector: string) { return selector === "[data-hf-id]" && this.dataset.hfId ? this : null; }
    focus() { this.focused = true; }
  }
  const first = new Element("a");
  const inactive = new Element("inactive");
  const second = new Element("b");
  const root = Object.assign(new Element(""), {
    querySelectorAll: () => [first, inactive, second],
    addEventListener: (_type: string, callback: (event: unknown) => void) => { handler = callback; },
  });
  let handler!: (event: unknown) => void;
  const messages: { primary: string; ids: string[]; origin: string }[] = [];
  const context = {
    root, HTMLElement: Element, activeTransform: null, activeMarquee: null, playbackActive: false, currentTime: 0,
    getComputedStyle: () => ({ visibility: "visible", display: "block", opacity: "1" }),
    targetIsActiveAt: (candidate: Element) => candidate !== inactive,
    selectedHfId: "a", selectedHfIds: new Set(["a"]),
    selectTarget: (target: Element, origin: string, ids: string[]) => messages.push({ primary: target.dataset.hfId, origin, ids: Array.from(ids) }),
    clearTarget: () => { throw new Error("Unexpected clear"); },
  };
  runInNewContext(renderCompositionCanvasKeyboardSelection(), context);
  let prevented = false;
  handler({ ...base, target: first, defaultPrevented: false, preventDefault: () => { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.deepEqual(messages, [{ primary: "b", origin: "PREVIEW", ids: ["b"] }]);
  assert.equal(second.focused, true);
  assert.equal(second.attributes.get("aria-label"), "b");
  context.playbackActive = true;
  handler({ ...base, target: first, defaultPrevented: false, preventDefault() { throw new Error("Playback intercepted"); }, stopPropagation() {} });
  assert.equal(messages.length, 1);
});
