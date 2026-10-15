import test from "node:test";
import assert from "node:assert/strict";
import {runObservedProducer, observeProducerSession, observeProducerBeforeFrame, observeProducerAfterFrame,
  ORIGINAL_SERVER_AUTHORIZATION_TIMEOUT_MILLISECONDS} from "./courseforge-producer-observer-v1.mjs";

const job = () => ({config: {workers: 1, useGpu: false, hdrMode: "force-sdr", producerConfig: {
  concurrency: 1, enableBrowserPool: false, disableGpu: true, browserGpuMode: "software", forceScreenshot: true,
  useDrawElement: false, enableDrawElementWorkerEncode: false, staticFrameDedup: false}}});
const base = {onSession: async () => {}, onBeforeFrame: async () => {}, onAfterFrame: async () => {}};
const session = (serverUrl = "http://localhost:43210") => ({serverUrl, page: {}, captureMode: "screenshot"});
const ack = {status: "AUTHORIZED", address: "127.0.0.1", port: 43210};
async function frame(current) {
  await observeProducerBeforeFrame(current, 0, 0, 0);
  await observeProducerAfterFrame(current, 0, 0, 0, Buffer.from("captured original frame"));
}

test("original session cannot acquire CDP or navigate before explicit exact server ACK", async () => {
  const current = session(); let release, acquired = false;
  const gate = new Promise(resolve => {release = resolve;});
  const completion = runObservedProducer(async () => {
    await observeProducerSession(current, async () => {acquired = true; return {};});
    assert.equal(current.serverUrl, "http://127.0.0.1:43210"); await frame(current);
  }, job(), new AbortController().signal, {...base, onOriginalServer: async candidate => {
    assert.equal(Object.isFrozen(candidate), true); assert.equal(candidate.serverUrl, "http://localhost:43210");
    await gate; return ack;
  }});
  await new Promise(done => setImmediate(done));
  assert.equal(acquired, false); assert.equal(current.serverUrl, "http://localhost:43210");
  release(); await completion; assert.equal(acquired, true);
});

test("bad candidates and mismatched ACKs latch failure even when SDK absorbs it", async () => {
  for (const [url, reply] of [["http://evil.test:43210", ack], ["http://localhost:65536", ack],
    ["http://localhost:043210", ack], ["http://localhost:43210/path", ack],
    ["http://localhost:43210", {...ack, port: 43211}], ["http://localhost:43210", {...ack, address: "::1"}],
    ["http://localhost:43210", undefined], ["http://localhost:43210", {...ack, extra: true}]]) {
    let acquired = false;
    await assert.rejects(runObservedProducer(async () => {
      try {await observeProducerSession(session(url), async () => {acquired = true; return {};});} catch {}
    }, job(), new AbortController().signal, {...base, onOriginalServer: async () => reply}), /SERVER_CANDIDATE_INVALID|SERVER_AUTHORIZATION_FAILED/);
    assert.equal(acquired, false);
  }
});

test("authorization deadline forbids late ACK and session mutation", async context => {
  context.mock.timers.enable({apis: ["setTimeout"]});
  const current = session(); let release, acquired = false, authorizationSignal;
  const completion = runObservedProducer(() => observeProducerSession(current, async () => {acquired = true; return {};}),
    job(), new AbortController().signal, {...base, onOriginalServer: candidate => {
      authorizationSignal = candidate.signal; return new Promise(resolve => {release = resolve;});
    }});
  await Promise.resolve(); context.mock.timers.tick(ORIGINAL_SERVER_AUTHORIZATION_TIMEOUT_MILLISECONDS);
  await assert.rejects(completion, /SERVER_AUTHORIZATION_FAILED/);
  assert.equal(authorizationSignal.aborted, true);
  release(ack); await Promise.resolve();
  assert.equal(acquired, false); assert.equal(current.serverUrl, "http://localhost:43210");
  context.mock.timers.reset();
});

test("abort while callback is pending never reaches original session setup", async () => {
  const cancellation = new AbortController(); let acquired = false;
  const completion = runObservedProducer(() => observeProducerSession(session(), async () => {acquired = true; return {};}),
    job(), cancellation.signal, {...base, onOriginalServer: async () => new Promise(() => {})});
  await Promise.resolve(); cancellation.abort();
  await assert.rejects(completion, /SERVER_AUTHORIZATION_FAILED/); assert.equal(acquired, false);
});

test("legacy observer leaves the upstream URL unchanged", async () => {
  const current = session();
  await runObservedProducer(async () => {await observeProducerSession(current, async () => ({})); await frame(current);},
    job(), new AbortController().signal, base);
  assert.equal(current.serverUrl, "http://localhost:43210");
});
