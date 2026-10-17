import assert from "node:assert/strict";
import test from "node:test";
import {bindCaptureCdpCancellation} from "../qa/composition-cdp-cancellation";
import type {CompositionQaCdpClient} from "../qa/composition-qa-browser";

test("pre-aborted capture closes channel and cannot send a command", async () => {
  const abort = new AbortController(); abort.abort("private reason"); let closes = 0;
  const binding = bindCaptureCdpCancellation({close: () => {closes++;}, send: async () => assert.fail("no send")}, abort.signal);
  await assert.rejects(binding.client.send("Page.navigate"), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  binding.dispose(); assert.equal(closes, 1);
});
test("abort rejects all stuck commands, closes once and rejects a late result", async () => {
  const abort = new AbortController(); let closes = 0;
  const resolvers: Array<(result: Record<string, unknown>) => void> = [];
  const binding = bindCaptureCdpCancellation({close: () => {closes++;},
    send: () => new Promise(resolve => {resolvers.push(resolve);})}, abort.signal);
  const commands = [binding.client.send("Runtime.evaluate"), binding.client.send("Page.captureScreenshot")];
  abort.abort("secret");
  for (const command of commands) await assert.rejects(command, /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  for (const resolve of resolvers) resolve({data: "late"});
  await assert.rejects(binding.client.send("Page.navigate"), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  binding.dispose(); assert.equal(closes, 1);
});
test("abort within adapter success cannot escape as a successful command", async () => {
  const abort = new AbortController();
  const binding = bindCaptureCdpCancellation({close: () => {}, send: async () => {abort.abort(); return {success: true};}}, abort.signal);
  await assert.rejects(binding.client.send("Runtime.evaluate"), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  binding.dispose();
});
test("disposal removes abort listener and ordinary failures preserve their identity", async () => {
  const abort = new AbortController(); let closes = 0; const failure = new Error("ordinary failure");
  const binding = bindCaptureCdpCancellation({close: () => {closes++;}, send: async () => {throw failure;}}, abort.signal);
  await assert.rejects(binding.client.send("Page.navigate"), error => error === failure);
  binding.dispose(); abort.abort(); assert.equal(closes, 0);
});
test("events after abort are suppressed while unsubscribe is preserved", () => {
  const abort = new AbortController(); let handled = 0, unsubscribed = 0;
  let event!: (params: Record<string, unknown>) => void;
  const client: CompositionQaCdpClient = {close: () => {}, send: async () => ({}),
    onEvent: (_method, handler) => {event = handler; return () => {unsubscribed++;};}};
  const binding = bindCaptureCdpCancellation(client, abort.signal);
  const unsubscribe = binding.client.onEvent!("Fetch.requestPaused", () => {handled++;});
  event({}); abort.abort(); event({}); unsubscribe(); binding.dispose();
  assert.equal(handled, 1); assert.equal(unsubscribed, 1);
});
test("close exception cannot leak private diagnostics from an abort callback", async () => {
  const abort = new AbortController();
  const binding = bindCaptureCdpCancellation({close: () => {throw new Error("private detail");}, send: () => new Promise(() => {})}, abort.signal);
  const command = binding.client.send("Runtime.evaluate");
  assert.doesNotThrow(() => abort.abort());
  await assert.rejects(command, /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  assert.equal(binding.closeFailed, true); binding.dispose();
});
