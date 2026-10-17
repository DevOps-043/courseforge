import test from "node:test";
import assert from "node:assert/strict";
import {runObservedProducer, observedProducerBrowserLaunchOptions, observeProducerSession,
  observeProducerBeforeFrame, observeProducerAfterFrame} from "./courseforge-producer-observer-v1.mjs";

const job = () => ({config: {workers: 1, useGpu: false, hdrMode: "force-sdr", producerConfig: {
  concurrency: 1, enableBrowserPool: false, disableGpu: true, browserGpuMode: "software", forceScreenshot: true,
  useDrawElement: false, enableDrawElementWorkerEncode: false, staticFrameDedup: false}}});
const observer = {onSession: async () => {}, onBeforeFrame: async () => {}, onAfterFrame: async () => {}};
async function frame() {
  const session = {page: {}, captureMode: "screenshot"};
  await observeProducerSession(session, async () => ({}));
  await observeProducerBeforeFrame(session, 0, 0, 0);
  await observeProducerAfterFrame(session, 0, 0, 0, Buffer.from("synthetic pixels, not a render"));
}
test("observed launch uses private CDP pipe, restores sandbox/isolation protections and retains other SDK flags", async () => {
  const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-ipc-flooding-protection", "--force-color-profile=srgb",
    "--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,Translate", "--autoplay-policy=no-user-gesture-required"];
  const original = [...args];
  await runObservedProducer(async () => {
    assert.deepEqual(observedProducerBrowserLaunchOptions(args), {pipe: true, args: ["--force-color-profile=srgb",
      "--disable-features=AudioServiceOutOfProcess,Translate", "--autoplay-policy=no-user-gesture-required"]});
    await frame();
  }, job(), new AbortController().signal, observer);
  assert.deepEqual(args, original);
  assert.deepEqual(observedProducerBrowserLaunchOptions(args), {}); // Legacy SDK behavior unchanged.
});
test("explicit debugging port or security bypass is latched even if the SDK swallows the error", async () => {
  for (const argument of ["--remote-debugging-port=0", "--remote-debugging-pipe", "--disable-web-security",
    "--ignore-certificate-errors", "--single-process", "--disable-site-isolation-trials", "--no-sandbox=true"]) {
    await assert.rejects(runObservedProducer(async () => {
      try {observedProducerBrowserLaunchOptions([argument]);} catch {}
      await frame();
    }, job(), new AbortController().signal, observer), /BROWSER_LAUNCH_INVALID/);
  }
});
test("empty disabled security feature list is omitted and malformed launch arguments fail closed", async () => {
  await runObservedProducer(async () => {
    assert.deepEqual(observedProducerBrowserLaunchOptions(["--disable-features=IsolateOrigins,site-per-process"]), {pipe: true, args: []});
    await frame();
  }, job(), new AbortController().signal, observer);
  for (const args of [null, [123], Array(129).fill("--known"), ["a".repeat(4097)]])
    await assert.rejects(runObservedProducer(async () => {observedProducerBrowserLaunchOptions(args);},
      job(), new AbortController().signal, observer), /BROWSER_LAUNCH_INVALID/);
});
