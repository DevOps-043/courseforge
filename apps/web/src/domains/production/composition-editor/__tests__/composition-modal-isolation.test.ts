import assert from "node:assert/strict";
import test from "node:test";
import { installCompositionModalIsolation } from "../composition-modal-isolation";

function fixture() {
  const focusListeners = new Set<(event: { target: unknown }) => void>();
  let mutationCallback = () => {};
  let disconnected = 0;
  class Observer {
    constructor(callback: () => void) { mutationCallback = callback; }
    observe() {}
    disconnect() { disconnected++; }
  }
  const owner = { body: null as unknown, activeElement: null as unknown, hasFocus: () => true,
    defaultView: { MutationObserver: Observer },
    addEventListener: (_: string, fn: (event: { target: unknown }) => void) => focusListeners.add(fn),
    removeEventListener: (_: string, fn: (event: { target: unknown }) => void) => focusListeners.delete(fn) };
  class Element {
    ownerDocument = owner;
    isConnected = true;
    parentElement: Element | null = null;
    children: Element[] = [];
    attributes = new Map<string, string>();
    append(child: Element) { this.children.push(child); child.parentElement = this; }
    contains(target: unknown): boolean { return target === this || this.children.some((child) => child.contains(target)); }
    getAttribute(key: string) { return this.attributes.get(key) ?? null; }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
  }
  const body = new Element(); owner.body = body;
  const editor = new Element(); const popupSurface = new Element(); const panel = new Element(); const backdrop = new Element();
  body.append(editor); body.append(popupSurface); popupSurface.append(panel); popupSurface.append(backdrop);
  const install = (target: Element) => installCompositionModalIsolation(target as unknown as HTMLElement,
    () => { owner.activeElement = target; });
  return { Element, owner, body, editor, popupSurface, panel, backdrop, install,
    mutate: () => mutationCallback(), disconnected: () => disconnected,
    focus: (target: Element) => { owner.activeElement = target; for (const callback of focusListeners) callback({ target }); },
    listenerCount: () => focusListeners.size };
}

test("modal blocks sibling branches but not body, surface or ancestors; restores exact prior attributes", () => {
  const f = fixture(); f.editor.setAttribute("inert", "original"); f.editor.setAttribute("aria-hidden", "false");
  const cleanup = f.install(f.panel);
  assert.equal(f.editor.getAttribute("inert"), ""); assert.equal(f.editor.getAttribute("aria-hidden"), "true");
  assert.equal(f.backdrop.getAttribute("aria-hidden"), "true");
  for (const node of [f.body, f.popupSurface, f.panel]) assert.equal(node.getAttribute("inert"), null);
  cleanup(); cleanup();
  assert.equal(f.editor.getAttribute("inert"), "original"); assert.equal(f.editor.getAttribute("aria-hidden"), "false");
  assert.equal(f.backdrop.getAttribute("aria-hidden"), null);
  assert.equal(f.listenerCount(), 0); assert.equal(f.disconnected(), 1);
});
test("topmost modal exclusively owns background and focus; closing it reactivates prior modal", () => {
  const f = fixture(); const closeFirst = f.install(f.panel);
  const second = new f.Element(); f.body.append(second); const closeSecond = f.install(second);
  assert.equal(f.popupSurface.getAttribute("inert"), ""); assert.equal(second.getAttribute("inert"), null);
  f.focus(f.editor); assert.equal(f.owner.activeElement, second);
  closeSecond(); assert.equal(f.popupSurface.getAttribute("inert"), null); assert.equal(f.editor.getAttribute("inert"), "");
  f.focus(f.editor); assert.equal(f.owner.activeElement, f.panel);
  closeFirst(); assert.equal(f.editor.getAttribute("inert"), null);
});
test("out-of-order disposal preserves top modal and does not resurrect stale blocked attributes", () => {
  const f = fixture(); const closeFirst = f.install(f.panel);
  const second = new f.Element(); f.body.append(second); const closeSecond = f.install(second);
  closeFirst(); assert.equal(f.editor.getAttribute("aria-hidden"), "true");
  f.focus(f.panel); assert.equal(f.owner.activeElement, second);
  closeSecond(); assert.equal(f.editor.getAttribute("aria-hidden"), null); assert.equal(f.popupSurface.getAttribute("inert"), null);
});
test("observer isolates newly mounted background branches and final disposal releases them", () => {
  const f = fixture(); const cleanup = f.install(f.panel);
  const newcomer = new f.Element(); f.body.append(newcomer); f.mutate();
  assert.equal(newcomer.getAttribute("aria-hidden"), "true");
  cleanup(); assert.equal(newcomer.getAttribute("aria-hidden"), null); assert.equal(newcomer.getAttribute("inert"), null);
});
test("focus remains inside active modal without stealing focus from another app", () => {
  const f = fixture(); const cleanup = f.install(f.panel);
  f.owner.hasFocus = () => false; f.focus(f.editor); assert.equal(f.owner.activeElement, f.editor);
  f.owner.hasFocus = () => true; f.focus(f.editor); assert.equal(f.owner.activeElement, f.panel);
  f.focus(f.panel); assert.equal(f.owner.activeElement, f.panel); cleanup();
});

test("new nested modal is focused after prior inert state is released", () => {
  const f = fixture(); const cleanup = f.install(f.panel);
  const nested = new f.Element(); f.editor.append(nested);
  const closeNested = f.install(nested);
  assert.equal(f.editor.getAttribute("inert"), null);
  assert.equal(f.owner.activeElement, nested);
  assert.equal(f.popupSurface.getAttribute("inert"), "");
  closeNested(); assert.equal(f.owner.activeElement, f.panel); cleanup();
});

test("cleanup does not overwrite background attributes changed by an external owner", () => {
  const f = fixture(); const cleanup = f.install(f.panel);
  f.editor.setAttribute("aria-hidden", "false"); f.editor.setAttribute("inert", "external-owner");
  cleanup();
  assert.equal(f.editor.getAttribute("aria-hidden"), "false"); assert.equal(f.editor.getAttribute("inert"), "external-owner");
});
