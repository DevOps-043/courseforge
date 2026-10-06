import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext, Script } from "node:vm";
import { resolveCompositionCanvasFocusRestore, renderCompositionCanvasFocusContinuity } from "../composition-canvas-focus-continuity";

const base = { sameClip: true, canvasFocused: true, clipVisible: true, equivalentControl: true };
test("reload focuses selected visible clip only from empty iframe focus; hidden selection falls back to root", () => {
  let count = 0;
  let rootCount = 0;
  let visible = true;
  let frameFocused = true;
  class Element {
    dataset = { hfId: "clip", editorLabel: "Título" };
    setAttribute() {}
    focus() { count++; }
  }
  const target = new Element();
  const body = {};
  const doc = { body, documentElement: {}, activeElement: body as unknown,
    hasFocus: () => frameFocused, querySelector: () => target };
  const restore = runInNewContext(`${renderCompositionCanvasFocusContinuity()} restoreCanvasFocusAfterReload;`, {
    HTMLElement: Element, document: doc, root: { focus: () => { rootCount++; } },
    selectedHfId: "clip", CSS: { escape: (id: string) => id }, currentTime: 0,
    targetIsActiveAt: () => visible, getComputedStyle: () => ({ visibility: "visible", display: "block", opacity: "1" }),
  }) as (id: string | null) => void;
  restore("clip"); assert.equal(count, 1);
  doc.activeElement = target; restore("clip"); assert.equal(count, 1);
  doc.activeElement = body; frameFocused = false; restore("clip"); assert.equal(count, 1);
  frameFocused = true; visible = false; restore("clip"); assert.equal(rootCount, 1);
  visible = true; restore("different"); assert.equal(count, 1); assert.equal(rootCount, 2);
});
test("same clip restores equivalent control, removed control falls back to clip", () => {
  assert.equal(resolveCompositionCanvasFocusRestore(base), "CONTROL");
  assert.equal(resolveCompositionCanvasFocusRestore({ ...base, equivalentControl: false }), "CLIP");
});
test("hidden clip returns focus to canvas, parent focus and different selection are preserved", () => {
  assert.equal(resolveCompositionCanvasFocusRestore({ ...base, clipVisible: false }), "ROOT");
  assert.equal(resolveCompositionCanvasFocusRestore({ ...base, canvasFocused: false }), "NONE");
  assert.equal(resolveCompositionCanvasFocusRestore({ ...base, sameClip: false }), "NONE");
});
test("serialized focus reconciler does not steal focus from parent or alter document selection", () => {
  class Element {
    closest() { return clip; }
  }
  const clip = new Element();
  let iframeFocused = true;
  let rootFocusCount = 0;
  let visible = false;
  const context = { HTMLElement: Element, document: { hasFocus: () => iframeFocused, activeElement: clip },
    root: { contains: () => true, focus: () => { rootFocusCount++; } },
    targetIsActiveAt: () => visible, currentTime: 2,
    getComputedStyle: () => ({ visibility: "visible", display: "block", opacity: "1" }) };
  const runtime = renderCompositionCanvasFocusContinuity();
  assert.doesNotThrow(() => new Script(runtime));
  const reconcile = runInNewContext(`${runtime} reconcileCanvasFocus;`, context) as () => void;
  reconcile();
  assert.equal(rootFocusCount, 1);
  iframeFocused = false;
  reconcile();
  assert.equal(rootFocusCount, 1);
  iframeFocused = true;
  visible = true;
  reconcile();
  assert.equal(rootFocusCount, 1);
});

test("serialized continuity captures a removed handle and focuses its replacement or clip fallback", () => {
  class Element {
    dataset: Record<string, string>;
    focused = false;
    controls: Element[] = [];
    classes: string[];
    classList: { contains: (name: string) => boolean };
    constructor(classes: string[] = []) {
      this.classes = classes;
      this.dataset = { hfId: "clip-a", editorLabel: "Clip A" };
      this.classList = { contains: (name) => this.classes.includes(name) };
    }
    closest() { return clip; }
    matches() { return this.classes.includes("composition-editor-control"); }
    querySelectorAll() { return this.controls; }
    setAttribute() {}
    focus() { this.focused = true; }
  }
  const clip = new Element();
  const oldHandle = new Element(["composition-editor-control", "composition-resize-handle"]);
  const replacement = new Element(["composition-editor-control", "composition-resize-handle"]);
  clip.controls = [replacement];
  const context = { HTMLElement: Element, document: { hasFocus: () => true, activeElement: oldHandle },
    root: { contains: () => true, focus() { throw new Error("Unexpected root focus"); } },
    targetIsActiveAt: () => true, currentTime: 2,
    getComputedStyle: () => ({ visibility: "visible", display: "block", opacity: "1" }) };
  const api = runInNewContext(`${renderCompositionCanvasFocusContinuity()} ({ capture: readCanvasControlFocus, restore: restoreCanvasControlFocus });`, context);
  const token = api.capture();
  assert.equal(token.kind, "RESIZE");
  api.restore(token, clip);
  assert.equal(replacement.focused, true);
  clip.controls = [];
  api.restore(token, clip);
  assert.equal(clip.focused, true);
});
