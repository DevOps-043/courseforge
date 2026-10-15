import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {Script, createContext} from "node:vm";
import {assertHtmlLayoutBeforeCapture, createOriginalSessionHtmlLayoutCapture} from "../qa/composition-html-layout-capture";
import {createHtmlReconstructionFixture} from "./composition-html-editing-reconstruction-fixtures";
import {prepareHtmlHistoricalReconstruction} from "../composition-html-editing-historical-reconstruction.server";

const documentFixture = () => prepareHtmlHistoricalReconstruction(createHtmlReconstructionFixture()).document;
function runtimeChannel(layout: unknown, events: string[] = []) {
  const context = createContext({window: {__courseforgeHtmlLayout: layout}});
  return {send: async (method: string, parameters?: Record<string, unknown>) => {
    assert.equal(method, "Runtime.evaluate");
    assert.equal(parameters?.awaitPromise, true); assert.equal(parameters.returnByValue, true);
    events.push("layout");
    try { return {result: {value: await new Script(String(parameters.expression)).runInContext(context)}}; }
    catch { return {exceptionDetails: {text: "private page details"}}; }
  }, on() {}, off() {}};
}
test("capture evaluates emitted host expression, waits readiness and freshly asserts every call", async () => {
  let resolveReady!: () => void, assertions = 0, status = "PENDING";
  const ready = new Promise<void>(resolve => {resolveReady = resolve;});
  const channel = runtimeChannel({ready, getState: () => status, assert: () => {assertions++;}});
  const capture = createOriginalSessionHtmlLayoutCapture({cdp: channel, document: documentFixture(), signal: new AbortController().signal});
  const pending = capture.assert(); await Promise.resolve(); assert.equal(assertions, 0);
  status = "READY"; resolveReady(); await pending;
  await capture.assert(); assert.equal(assertions, 2);
  capture.close(); await assert.rejects(capture.assert(), /UNAVAILABLE/);
});
test("missing, failed, disposed and malformed runtime/CDP results fail closed without private diagnostics", async () => {
  for (const layout of [undefined, {}, {ready: Promise.resolve(), getState: () => "FAILED", assert() {}},
    {ready: Promise.resolve(), getState: () => "DISPOSED", assert() {}},
    {ready: Promise.resolve(), getState: () => "READY", assert() {throw new Error("private geometry");}}]) {
    await assert.rejects(assertHtmlLayoutBeforeCapture(runtimeChannel(layout), true),
      {message: "CONFORMANCE_HTML_LAYOUT_UNAVAILABLE"});
  }
  for (const response of [{}, {result: {}}, {result: {value: "true"}}, {result: {value: true}, exceptionDetails: {}}]) {
    const client = {send: async () => response};
    await assert.rejects(assertHtmlLayoutBeforeCapture(client, true), /UNAVAILABLE/);
  }
});
test("native-only compositions retain their path without CDP layout commands", async () => {
  const document = documentFixture(); delete document.htmlEditing;
  const events: string[] = [], channel = runtimeChannel(undefined, events);
  const capture = createOriginalSessionHtmlLayoutCapture({document, cdp: channel, signal: new AbortController().signal});
  assert.equal(capture.required, false); await capture.assert(); await capture.assert();
  assert.deepEqual(events, []); capture.close();
});
test("changed layout rejection remains latched even if the page reports recovery", async () => {
  let rejected = false, assertions = 0;
  const channel = runtimeChannel({ready: Promise.resolve(), getState: () => "READY", assert() {
    assertions++; if (rejected) throw new Error("private overflow");
  }});
  const capture = createOriginalSessionHtmlLayoutCapture({document: documentFixture(), cdp: channel, signal: new AbortController().signal});
  await capture.assert(); rejected = true; await assert.rejects(capture.assert(), /UNAVAILABLE/);
  rejected = false; await assert.rejects(capture.assert(), /UNAVAILABLE/); assert.equal(assertions, 2); capture.close();
});
test("abort, close and concurrent reads cannot admit an in-flight result or detach the SDK channel", async () => {
  for (const mode of ["abort", "close", "concurrent"] as const) {
    const controller = new AbortController(); let resolveCommand!: (value: unknown) => void;
    let detachments = 0;
    const channel = {send: async () => new Promise<unknown>(resolve => {resolveCommand = resolve;}), on() {}, off() {},
      detach() {detachments++;}};
    const capture = createOriginalSessionHtmlLayoutCapture({document: documentFixture(), cdp: channel, signal: controller.signal});
    const pending = capture.assert();
    if (mode === "abort") controller.abort();
    else if (mode === "close") capture.close();
    else await assert.rejects(capture.assert(), /UNAVAILABLE/);
    resolveCommand({result: {value: true}}); await assert.rejects(pending, /UNAVAILABLE/);
    if (mode === "close") assert.throws(() => capture.close(), /BORROWED_CDP_COMMAND_FAILED/);
    else capture.close();
    assert.equal(detachments, 0);
  }
});
test("actual SDK observer checks all forward frames and reverse leases after checkpoint capture finishes", async () => {
  const events: string[] = [];
  const channel = runtimeChannel({ready: Promise.resolve(), getState: () => "READY", assert() {}}, events);
  const source = readFileSync(join(process.cwd(), "tools/controlled-hyperframes/original-session-native-observer.mjs"), "utf8");
  const body = source.slice(source.indexOf("const {startOriginalSessionNativeCapture}"))
    .replace("export function createOriginalSessionNativeObserver", "function createOriginalSessionNativeObserver");
  let textFinished = false;
  const native = {close() {}, captureFrame: async () => {if (!textFinished) events.push("text");},
    repeatAtLastCheckpoint: async (index: number, prepare: (index: number, seconds: number) => Promise<unknown>) => {
      if (index === 0) { await prepare(0, 0); textFinished = true; }
    }};
  const modules = (path: string) => {
    if (path.endsWith("composition-html-layout-capture.js")) return {createOriginalSessionHtmlLayoutCapture};
    return {startOriginalSessionNativeCapture: async () => native,
      createOriginalSessionSeekCapture: () => ({captureFrame: async (index: number, _seconds: number, _buffer: Buffer,
        capture: (index: number, seconds: number) => Promise<unknown>) => {if (index === 0) await capture(0, 0);}})};
  };
  const factory = new Function("require", `${body}; return createOriginalSessionNativeObserver;`)(modules);
  const recorder = factory({plan: {document: documentFixture(), contract: {renderExecution: {seekRepeatabilityPolicy: true}}},
    assertUnchanged: async () => {}}, new AbortController().signal);
  const session = {};
  await recorder.observer.onSession({session, cdp: channel});
  const prepareFrame = async () => {events.push("prepare"); return {quantizedTime: 0};};
  const captureFrame = async () => {events.push("screenshot"); return {quantizedTime: 0, buffer: Buffer.from("test")};};
  for (const frameIndex of [0, 1]) {
    await recorder.observer.onBeforeFrame({session, frameIndex, quantizedTime: frameIndex});
    await recorder.observer.onAfterFrame({session, frameIndex, quantizedTime: frameIndex, buffer: Buffer.from("test"), prepareFrame, captureFrame});
  }
  assert.deepEqual(events, ["layout", "text", "layout", "prepare", "layout", "prepare", "layout", "screenshot", "layout",
    "layout", "layout"]);
  assert.equal(textFinished, true);
  recorder.close();
});
