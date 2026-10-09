import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {borrowProducerCdpChannel, BORROWED_PRODUCER_CDP_POLICY} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-borrowed-producer-cdp.js");
const {startOriginalSessionFontCapture} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-original-session-font-capture.js");
function fixture() {
  const controller = new AbortController(), listeners = new Map();
  let detachCount = 0, failRemove = false;
  const channel = {send: async () => ({}), on(method, callback) {
    const callbacks = listeners.get(method) ?? new Set(); callbacks.add(callback); listeners.set(method, callbacks);
  }, off(method, callback) {if (failRemove) throw new Error("private cleanup info"); listeners.get(method)?.delete(callback);},
  detach() {detachCount++;}};
  const client = borrowProducerCdpChannel(channel, controller.signal);
  return {client, channel, controller, listeners, detached: () => detachCount,
    failRemove: value => {failRemove = value;}, emit: (method, payload) => {for (const callback of listeners.get(method) ?? []) callback(payload);}};
}
test("borrowed listener lifecycle never detaches original SDK CDP or removes others' listeners", async () => {
  const f = fixture(); let ours = 0, theirs = 0;
  f.channel.on("CSS.fontsUpdated", () => theirs++);
  const unsubscribe = f.client.onEvent("CSS.fontsUpdated", () => ours++);
  f.emit("CSS.fontsUpdated", {}); assert.equal(ours, 1); assert.equal(theirs, 1);
  unsubscribe(); unsubscribe(); f.client.close(); f.client.close();
  f.emit("CSS.fontsUpdated", {}); assert.equal(ours, 1); assert.equal(theirs, 2);
  assert.equal(f.detached(), 0);
  await assert.rejects(f.client.send("DOM.enable"), /CDP_CLOSED/);
  await f.client.send("Runtime.releaseObject", {objectId: "leased-handle"});
});
test("abort removes own listeners, preserves release operation and rejects late command success", async () => {
  const f = fixture();
  let resolveCommand;
  f.channel.send = async () => new Promise(resolve => {resolveCommand = resolve;});
  f.client.onEvent("CSS.fontsUpdated", () => assert.fail("event after abort"));
  const command = f.client.send("DOM.enable");
  f.controller.abort(); resolveCommand({});
  await assert.rejects(command, {name: "AbortError"});
  assert.equal(f.listeners.get("CSS.fontsUpdated").size, 0);
  f.channel.send = async () => ({});
  await f.client.send("Runtime.releaseObject", {objectId: "leased-handle"});
  assert.equal(f.detached(), 0);
});
test("callback and cleanup failures remain latched without private diagnostics", async () => {
  const command = fixture(); command.channel.send = async () => {throw new Error("private command info");};
  await assert.rejects(command.client.send("DOM.enable"), {message: "CONTROLLED_RENDER_BORROWED_CDP_COMMAND_FAILED"});
  command.channel.send = async () => ({});
  await assert.rejects(command.client.send("DOM.enable"), /CDP_COMMAND_FAILED/);
  await command.client.send("Runtime.releaseObject", {objectId: "leased-handle"});
  assert.throws(() => command.client.close(), /CDP_COMMAND_FAILED/);
  const event = fixture(); event.client.onEvent("CSS.fontsUpdated", () => {throw new Error("private callback info");});
  event.emit("CSS.fontsUpdated", {});
  await assert.rejects(event.client.send("DOM.enable"), {message: "CONTROLLED_RENDER_BORROWED_CDP_EVENT_FAILED"});
  assert.throws(() => event.client.close(), /CDP_EVENT_FAILED/);
  const cleanup = fixture(); cleanup.client.onEvent("CSS.fontsUpdated", () => {}); cleanup.failRemove(true);
  assert.throws(() => cleanup.client.close(), {message: "CONTROLLED_RENDER_BORROWED_CDP_CLEANUP_FAILED"});
  cleanup.failRemove(false);
  assert.throws(() => cleanup.client.close(), /CDP_CLEANUP_FAILED/);
  assert.equal(cleanup.listeners.get("CSS.fontsUpdated").size, 0);
  assert.equal(cleanup.detached(), 0);
});
test("subscription quota and subscribe-then-throw retain cleanup ownership", () => {
  const quota = fixture();
  for (let index = 0; index < BORROWED_PRODUCER_CDP_POLICY.maximumSubscriptions; index++) quota.client.onEvent(`event${index}`, () => {});
  assert.throws(() => quota.client.onEvent("extra", () => {}), /SUBSCRIPTION_LIMIT/); quota.client.close();
  const failure = fixture(), original = failure.channel.on;
  failure.channel.on = (...args) => {original(...args); throw new Error("private subscribe info");};
  assert.throws(() => failure.client.onEvent("CSS.fontsUpdated", () => {}), /CDP_SUBSCRIBE_FAILED/);
  assert.equal(failure.listeners.get("CSS.fontsUpdated").size, 0);
  assert.throws(() => failure.client.close(), /CDP_SUBSCRIBE_FAILED/);
});
test("original font factory rejects nonlocal origins and invalid plans without detaching SDK", async () => {
  const f = fixture();
  for (const serverUrl of ["https://127.0.0.1:4000", "http://example.com", "http://user:pass@localhost", "http://localhost/foreign", "http://localhost/?query=1"])
    await assert.rejects(startOriginalSessionFontCapture({cdp: f.channel, signal: f.controller.signal,
      serverUrl, verifyFiles: async () => {}}), /ORIGINAL_FONT_ORIGIN_INVALID/);
  await assert.rejects(startOriginalSessionFontCapture({cdp: f.channel, signal: f.controller.signal,
    serverUrl: "http://127.0.0.1:4000", verifyFiles: async () => {}, document: {}, contract: {}, fonts: []}));
  assert.equal(f.detached(), 0);
});
