import assert from "node:assert/strict";
import test from "node:test";
import { installCompositionPanelKeyboard, type CompositionKeyboardPanelKind } from "../composition-panel-keyboard";

function fixture(kind: CompositionKeyboardPanelKind) {
  let listener: ((event: KeyboardEvent) => void) | null = null;
  let closed = 0;
  let canClose = true;
  const owner = { activeElement: null as unknown, body: {}, hasFocus: () => true,
    addEventListener() {}, removeEventListener() {} };
  class Element {
    isConnected = true;
    disabled = false;
    hidden = false;
    focusCount = 0;
    matches() { return this.disabled; }
    closest() { return this.hidden ? this : null; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    focus() { this.focusCount++; owner.activeElement = this; }
  }
  const opener = new Element(); opener.focus();
  const first = new Element();
  const disabled = new Element(); disabled.disabled = true;
  const hidden = new Element(); hidden.hidden = true;
  const last = new Element();
  const elements = [first, disabled, hidden, last];
  const panel = {
    isConnected: true,
    ownerDocument: owner, querySelectorAll: () => elements, contains: (element: unknown) => elements.includes(element as Element),
    focus: () => { owner.activeElement = panel; },
    addEventListener: (_: string, callback: typeof listener) => { listener = callback; },
    removeEventListener: () => { listener = null; },
  };
  const cleanup = installCompositionPanelKeyboard(panel as unknown as HTMLElement, { kind,
    onClose: () => { closed++; }, canClose: () => canClose });
  const send = (key: string, override = {}) => {
    let prevented = false;
    listener?.({ key, preventDefault: () => { prevented = true; }, stopPropagation() {}, ...override } as unknown as KeyboardEvent);
    return prevented;
  };
  return { owner, opener, first, last, send, cleanup, closed: () => closed, setCanClose: (value: boolean) => { canClose = value; } };
}

test("menu focuses eligible first item and wraps arrows/Home/End without disabled or hidden items", () => {
  const f = fixture("MENU"); assert.equal(f.owner.activeElement, f.first);
  f.send("ArrowUp"); assert.equal(f.owner.activeElement, f.last);
  f.send("ArrowDown"); assert.equal(f.owner.activeElement, f.first);
  f.send("End"); assert.equal(f.owner.activeElement, f.last);
  f.send("Home"); assert.equal(f.owner.activeElement, f.first);
  f.send("ArrowDown", { ctrlKey: true }); assert.equal(f.owner.activeElement, f.first);
  f.cleanup(); assert.equal(f.owner.activeElement, f.opener);
});
test("modal traps endpoints and Escape closes once while preserving cancellation policy", () => {
  const f = fixture("MODAL");
  assert.equal(f.send("Tab", { shiftKey: true }), true); assert.equal(f.owner.activeElement, f.last);
  assert.equal(f.send("Tab"), true); assert.equal(f.owner.activeElement, f.first);
  f.setCanClose(false); f.send("Escape"); assert.equal(f.closed(), 0);
  f.setCanClose(true); f.send("Escape"); assert.equal(f.closed(), 1);
  f.send("Escape", { repeat: true }); assert.equal(f.closed(), 1);
  f.cleanup(); assert.equal(f.owner.activeElement, f.opener);
});
test("nonmodal Tab exits without trapping or forcing focus back to opener", () => {
  for (const kind of ["POPOVER", "MENU"] as const) {
    const f = fixture(kind); assert.equal(f.send("Tab"), false); assert.equal(f.closed(), 1);
    f.owner.activeElement = f.owner.body; f.cleanup(); assert.equal(f.opener.focusCount, 1);
  }
});
test("closing does not steal focus from another control, disconnected opener or another app", () => {
  const external = {};
  const f = fixture("POPOVER"); f.owner.activeElement = external; f.cleanup(); assert.equal(f.owner.activeElement, external);
  const removed = fixture("MODAL"); removed.opener.isConnected = false; removed.cleanup(); assert.equal(removed.opener.focusCount, 1);
  const unfocused = fixture("MODAL"); unfocused.owner.hasFocus = () => false; unfocused.cleanup(); assert.equal(unfocused.opener.focusCount, 1);
});
test("IME and previously consumed events remain owned by inputs or nested controls", () => {
  const f = fixture("MODAL"); f.send("Escape", { isComposing: true }); f.send("Escape", { defaultPrevented: true });
  assert.equal(f.closed(), 0); f.cleanup();
});
