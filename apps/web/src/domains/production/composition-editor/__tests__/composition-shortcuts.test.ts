import assert from "node:assert/strict";
import test from "node:test";
import { Script, createContext } from "node:vm";
import { COMPOSITION_SHORTCUTS, COMPOSITION_SHORTCUT_ACTIONS } from "../composition-shortcuts";
import { compositionNavigationTime, compositionShortcutAvailable, findCompositionShortcut, resolveCompositionShortcut, type ShortcutKeyEvent } from "../composition-shortcut-policy";
import { CompositionTransportIntent, compositionTransportEnabled } from "../composition-transport-policy";
import { createCompositionPreviewParentCommand, parseCompositionPreviewIframeMessage } from "../composition-preview-protocol";
import { buildCompositionPreviewKeyboardRuntime } from "../composition-preview-keyboard-runtime";

const key = (value: string, extra: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: value, code: value === " " ? "Space" : value, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...extra,
});

test("catalog documents every command once and leaves native/local shortcuts unregistered", () => {
  assert.deepEqual(COMPOSITION_SHORTCUTS.flatMap((entry) => entry.action ? [entry.action] : []).sort(), [...COMPOSITION_SHORTCUT_ACTIONS].sort());
  assert.equal(resolveCompositionShortcut(key("ArrowRight"), "timeline"), null);
  assert.equal(resolveCompositionShortcut(key("Tab"), "preview"), null);
  assert.equal(resolveCompositionShortcut(key("Home"), "preview"), null);
  assert.equal(resolveCompositionShortcut(key("Home"), "timeline")?.action, "seek-start");
  assert.equal(resolveCompositionShortcut(key("F"), "preview")?.action, "toggle-fullscreen");
});

test("exact combinations protect IME, modifiers and consumed events; question mark follows layout", () => {
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing", "defaultPrevented"] as const) {
    assert.equal(resolveCompositionShortcut(key(" ", { [modifier]: true }), "preview"), null);
  }
  assert.equal(resolveCompositionShortcut(key("?", { code: "Slash", shiftKey: true }), "preview")?.action, "open-shortcuts");
  assert.equal(resolveCompositionShortcut(key("?", { code: "Minus", shiftKey: true }), "preview")?.action, "open-shortcuts");
  assert.equal(resolveCompositionShortcut(key("s", { repeat: true }), "timeline")?.repeat, undefined);
  assert.equal(resolveCompositionShortcut(key("PageDown", { repeat: true }), "timeline")?.repeat, true);
});

test("transport availability is shared while help and view controls remain available", () => {
  const ready = { saving: false, previewReady: true, previewMediaState: "READY" };
  assert.equal(compositionTransportEnabled(ready), true);
  assert.equal(compositionTransportEnabled({ ...ready, previewMediaState: "BUFFERING" }), true);
  for (const state of [{ ...ready, saving: true }, { ...ready, previewReady: false }, { ...ready, previewMediaState: "PREPARING" }]) assert.equal(compositionTransportEnabled(state), false);
  assert.equal(compositionShortcutAvailable("open-shortcuts", false), true);
  assert.equal(compositionShortcutAvailable("seek-end", false), false);
});

test("rapid toggles use pending intent and ignore old acknowledgements; missing acknowledgements expire", () => {
  const intent = new CompositionTransportIntent();
  const first = intent.toggle(false, 0);
  assert.equal(first.active, true);
  const second = intent.toggle(false, 1);
  assert.equal(second.active, false);
  intent.acknowledge(first.requestId);
  assert.equal(intent.toggle(true, 2).active, true);
  intent.reset();
  assert.equal(intent.toggle(true, 3).active, false);
  assert.equal(intent.toggle(false, 5_000).active, true);
  intent.reset();
  const latest = intent.toggle(false, 5_001);
  intent.acknowledge(latest.requestId);
  assert.equal(intent.toggle(true, 5_002).active, false);
});

test("scene navigation is ordered, strict at boundaries and never wraps", () => {
  const starts = [10, 0, 5, 5, Number.NaN, -1, 40];
  assert.equal(compositionNavigationTime("next-scene", 5, 20, starts), 10);
  assert.equal(compositionNavigationTime("previous-scene", 5, 20, starts), 0);
  assert.equal(compositionNavigationTime("previous-scene", 7, 20, starts), 5);
  assert.equal(compositionNavigationTime("previous-scene", 0, 20, starts), null);
  assert.equal(compositionNavigationTime("next-scene", 20, 20, starts), null);
  assert.equal(compositionNavigationTime("seek-end", 0, 20, []), 20);
});

test("shortcut protocol accepts only bounded known actions and session IDs", () => {
  const sessionId = "a0000000-0000-4000-8000-000000000001";
  const message = { type: "courseforge-composition-shortcut", action: "toggle-playback", sessionId };
  assert.ok(parseCompositionPreviewIframeMessage(message));
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, action: "delete-all" }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, sessionId: "old" }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ ...message, text: "private input" }), null);
  assert.ok(createCompositionPreviewParentCommand({ type: "courseforge-composition-play", requestId: 1 }));
  assert.equal(createCompositionPreviewParentCommand({ type: "courseforge-composition-play", requestId: -1 }), null);
});

test("serialized resolver has the same behavior without module imports", () => {
  const resolver = new Script(`(${findCompositionShortcut.toString()})`).runInNewContext() as typeof findCompositionShortcut;
  for (const scope of ["preview", "timeline"] as const) for (const value of [" ", "?", "Home", "End", "PageUp", "PageDown", "F", "g", "s", "x"]) {
    assert.equal(resolver(key(value), scope, COMPOSITION_SHORTCUTS)?.action, resolveCompositionShortcut(key(value), scope)?.action);
  }
});

test("iframe adapter fails closed until configured, filters controls/repetition/gestures and forwards one semantic action", () => {
  const handlers = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  const posted: unknown[] = [];
  class Element {
    isContentEditable = false;
    constructor(private control = false) {}
    closest(selector: string) { return selector.includes("data-composition-time-ruler") ? null : this.control ? this : null; }
  }
  const document = { addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, [...(handlers.get(name) ?? []), handler]) };
  const parent = {};
  const window = { parent, addEventListener: document.addEventListener };
  const context = createContext({ root: null, document, window, Element, HTMLElement: Element, activeTransform: null, postParentMessage: (message: unknown) => posted.push(message) });
  new Script(buildCompositionPreviewKeyboardRuntime()).runInContext(context);
  const fire = (name: string, event: Record<string, unknown>) => handlers.get(name)?.forEach((handler) => handler(event));
  let prevented = 0;
  const event = { ...key(" "), target: new Element(), preventDefault: () => prevented++ };
  fire("keydown", event);
  assert.equal(posted.length, 0);
  const settings = { type: "courseforge-composition-shortcut-settings", protocolVersion: 1, sessionId: "a0000000-0000-4000-8000-000000000001", actions: ["toggle-playback", "toggle-fullscreen", "open-shortcuts"] };
  fire("message", { source: {}, data: settings });
  fire("keydown", event);
  assert.equal(posted.length, 0);
  fire("message", { source: parent, data: settings });
  fire("keydown", event);
  fire("keydown", { ...event, repeat: true });
  assert.equal(posted.length, 1);
  assert.equal(prevented, 2);
  fire("keydown", { ...event, target: new Element(true) });
  fire("pointerdown", {});
  fire("keydown", event);
  assert.equal(posted.length, 1);
  fire("pointerup", {});
  fire("keydown", { ...event, ...key("f") });
  assert.equal(posted.length, 1, "fullscreen stays with a real user activation in the parent");
  fire("keydown", { ...event, ...key("?", { shiftKey: true }) });
  assert.equal(posted.length, 2);
  fire("message", { source: parent, data: { ...settings, actions: [] } });
  fire("keydown", event);
  assert.equal(posted.length, 2);
});
