import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { renderCompositionCanvasControlKeyboard } from "../composition-canvas-control-keyboard";
import { boundCompositionCanvasResize } from "../composition-canvas-snap-geometry";

function fixture(mode = "move") {
  const handlers: Record<string, (event: any) => void> = {};
  const messages: any[] = [];
  const initialCrop = { top: 0, right: 0, bottom: 0, left: 0 };
  let crop = { ...initialCrop };
  class Element {
    dataset = { hfId: "clip", cropEdge: "w" };
    style = { left: "20px", top: "30px", width: "100px", height: "50px" };
    closest(selector: string): Element { return selector === "[data-hf-id]" ? target : this; }
    matches(selector: string) { return selector === `.composition-${mode === "crop" ? "crop" : mode === "resize" ? "resize" : "move"}-handle`; }
  }
  const target = new Element();
  const control = new Element();
  const readLayoutBox = () => ({ x: parseFloat(target.style.left), y: parseFloat(target.style.top), width: parseFloat(target.style.width), height: parseFloat(target.style.height) });
  const context = { HTMLElement: Element,
    root: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
    window: { addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; } },
    activeTransform: null, activeMarquee: null, playbackActive: false, editingEnabled: true, cropEnabled: true,
    canvasWidth: 300, canvasHeight: 200, selectedHfId: "clip", canvasClipIsVisible: () => true,
    readLayoutBox, readCrop: () => ({ ...crop }), applyCrop: (_: unknown, next: typeof crop) => { crop = { ...next }; },
    adjustCropFromHandle: (current: typeof crop, _: unknown, edge: string, dx: number) => ({ ...current, left: edge === "w" ? Math.max(0, current.left + dx) : current.left }),
    scaleCropForLayout: (current: typeof crop) => current,
    boundCanvasResize: boundCompositionCanvasResize, canvasSnapGeometry: { minimumSizePixels: 24 },
    commitCrop: () => messages.push({ crop: { ...crop } }), postParentMessage: (message: unknown) => messages.push(message) };
  runInNewContext(renderCompositionCanvasControlKeyboard(), context);
  const dispatch = (name: string, key = "", extra = {}) => handlers[name]({ target: control, key, preventDefault() {}, stopPropagation() {}, ...extra });
  return { dispatch, target, context, messages, readLayoutBox, readCrop: () => crop };
}

test("autorepeat commits once after all held arrows are released", () => {
  const f = fixture();
  f.dispatch("keydown", "ArrowRight"); f.dispatch("keydown", "ArrowRight", { repeat: true });
  f.dispatch("keydown", "ArrowDown", { shiftKey: true });
  assert.equal(f.messages.length, 0);
  f.dispatch("keyup", "ArrowRight"); assert.equal(f.messages.length, 0);
  f.dispatch("keyup", "ArrowDown"); f.dispatch("keyup", "ArrowDown");
  assert.equal(f.messages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages[0].layout)), { x: 22, y: 40, width: 100, height: 50 });
});

test("Escape and blur restore original geometry without committing", () => {
  for (const cancel of ["Escape", "blur", "focusout", "pointerdown"]) {
    const f = fixture(); f.dispatch("keydown", "ArrowRight");
    f.dispatch(cancel === "Escape" ? "keydown" : cancel, cancel);
    f.dispatch("keyup", "ArrowRight");
    assert.equal(f.readLayoutBox().x, 20); assert.equal(f.messages.length, 0);
  }
});

test("vertical resize preserves ratio, Alt resize changes one axis and bounds are enforced", () => {
  const f = fixture("resize"); f.dispatch("keydown", "ArrowDown", { shiftKey: true }); f.dispatch("keyup", "ArrowDown");
  assert.equal(f.readLayoutBox().width, 120); assert.equal(f.readLayoutBox().height, 60);
  f.dispatch("keydown", "ArrowRight", { altKey: true }); f.dispatch("keyup", "ArrowRight");
  assert.equal(f.readLayoutBox().width, 121); assert.equal(f.readLayoutBox().height, 60);
  for (let count = 0; count < 100; count++) f.dispatch("keydown", "ArrowDown", { shiftKey: true });
  f.dispatch("keyup", "ArrowDown");
  assert.ok(f.readLayoutBox().width <= 280); assert.ok(f.readLayoutBox().height <= 170);
});

test("crop uses crop commit, no-op and disabled/composing gestures never persist", () => {
  const f = fixture("crop"); f.dispatch("keydown", "ArrowDown"); f.dispatch("keyup", "ArrowDown");
  assert.equal(f.messages.length, 0);
  f.dispatch("keydown", "ArrowRight"); f.dispatch("keyup", "ArrowRight");
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].crop.left, 1);
  f.dispatch("keydown", "ArrowRight", { isComposing: true }); f.dispatch("keyup", "ArrowRight");
  f.context.editingEnabled = false;
  f.dispatch("keydown", "ArrowRight"); f.dispatch("keyup", "ArrowRight");
  assert.equal(f.messages.length, 1);
  f.context.editingEnabled = true; f.dispatch("keydown", "ArrowRight"); f.dispatch("keydown", "Escape");
  assert.equal(f.readCrop().left, 1);
});
