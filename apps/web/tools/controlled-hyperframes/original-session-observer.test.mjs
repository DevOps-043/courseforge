import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createOriginalSessionObserver} from "./original-session-observer.mjs";
const version = {protocolVersion: "1.3", product: "Test", revision: "Test", userAgent: "Test", jsVersion: "Test"};
const fixture = () => {
  const controller = new AbortController(), session = {}, buffer = Buffer.from("original screenshot");
  const payload = {session, frameIndex: 0, time: 0, quantizedTime: 0, buffer,
    sha256: createHash("sha256").update(buffer).digest("hex")};
  let currentVersion = version;
  const cdp = {send: async method => {assert.equal(method, "Browser.getVersion"); return currentVersion;}};
  const recorder = createOriginalSessionObserver({expectedBrowser: version, signal: controller.signal});
  const capture = async () => {
    await recorder.observer.onSession({session, cdp});
    await recorder.observer.onBeforeFrame(payload);
    await recorder.observer.onAfterFrame(payload);
  };
  return {controller, session, payload, cdp, recorder, capture, changeVersion: value => {currentVersion = value;}};
};
test("fixed observer records original CDP versions and bounded digest, never conformance", async () => {
  const f = fixture(); await f.capture();
  const evidence = f.recorder.finalize();
  assert.equal(evidence.frameCount, 1);
  assert.equal(evidence.scope, "ORIGINAL_CDP_SELF_REPORTED_VERSION_AND_FRAME_DIGEST_NOT_CONFORMANCE");
  const {frameIndex, time, quantizedTime, sha256} = f.payload;
  assert.equal(evidence.frameDigestSha256, createHash("sha256").update(`${JSON.stringify({frameIndex, time, quantizedTime, sha256})}\n`).digest("hex"));
  assert.deepEqual(evidence.browserBefore, version);
  assert.deepEqual(evidence.browserAfter, version);
  assert.throws(() => f.recorder.finalize(), /FINALIZED/);
});
test("missing/incomplete frames, sequence drift and frame-byte mutation reject", async () => {
  const f = fixture(); assert.throws(() => f.recorder.finalize(), /INCOMPLETE/);
  await f.recorder.observer.onSession({session: f.session, cdp: f.cdp});
  await f.recorder.observer.onBeforeFrame(f.payload);
  assert.throws(() => f.recorder.finalize(), /INCOMPLETE/);
  await assert.rejects(f.recorder.observer.onAfterFrame({...f.payload, buffer: Buffer.from("different")}), /CAPTURE_FAILED/);
  assert.throws(() => f.recorder.finalize(), /CAPTURE_FAILED/);
  const sequence = fixture(); await sequence.capture();
  await assert.rejects(sequence.recorder.observer.onBeforeFrame(sequence.payload), /CAPTURE_FAILED/);
});
test("browser version drift and a different actual capture session cannot be accepted", async () => {
  const f = fixture();
  await f.recorder.observer.onSession({session: f.session, cdp: f.cdp});
  await f.recorder.observer.onBeforeFrame(f.payload);
  f.changeVersion({...version, revision: "changed"});
  await assert.rejects(f.recorder.observer.onAfterFrame(f.payload), /CAPTURE_FAILED/);
  const changed = fixture(); await changed.capture();
  const other = {};
  await changed.recorder.observer.onSession({session: other, cdp: changed.cdp});
  await assert.rejects(changed.recorder.observer.onBeforeFrame({...changed.payload, session: other, frameIndex: 1}), /CAPTURE_FAILED/);
});
test("abort and private CDP failure remain latched without private diagnostics", async () => {
  const f = fixture(); f.controller.abort();
  await assert.rejects(f.capture(), {message: "CONTROLLED_RENDER_ORIGINAL_SESSION_CAPTURE_FAILED"});
  const failed = fixture();
  await assert.rejects(failed.recorder.observer.onSession({session: failed.session,
    cdp: {send: async () => {throw new Error("private session info");}}}), {message: "CONTROLLED_RENDER_ORIGINAL_SESSION_CAPTURE_FAILED"});
});
