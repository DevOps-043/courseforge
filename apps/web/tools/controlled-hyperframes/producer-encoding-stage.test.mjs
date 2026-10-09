import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {transformProducerExtension} from "./producer-extension-v1.mjs";
import {runObservedProducer, observeProducerSession, observeProducerBeforeFrame, observeProducerAfterFrame,
  encodeObservedProducerStage, observeProducerAssembly} from "./courseforge-producer-observer-v1.mjs";

function fixture() {
  const signal = new AbortController().signal;
  const job = {duration: 0.04, config: {format: "mp4", fps: {num: 25, den: 1}, workers: 1, useGpu: false, hdrMode: "force-sdr",
    producerConfig: {concurrency: 1, enableBrowserPool: false, enableStreamingEncode: false, disableGpu: true, browserGpuMode: "software",
      forceScreenshot: true, useDrawElement: false, enableDrawElementWorkerEncode: false, staticFrameDedup: false}}};
  const input = {job, abortSignal: signal, width: 2, height: 2, needsAlpha: false, hasAudio: true,
    isGif: false, isPngSequence: false, videoOnlyPath: "silent.mp4", outputPath: "output.mp4"};
  const observer = {onSession: async () => {}, onBeforeFrame: async () => {}, onAfterFrame: async () => {},
    onEncode: async () => ({encodeMs: 1}), onAfterAssemble: async () => {}};
  const forward = async () => {
    const session = {page: {}, captureMode: "screenshot"};
    await observeProducerSession(session, async () => ({}));
    await observeProducerBeforeFrame(session, 0, 0, 0);
    await observeProducerAfterFrame(session, 0, 0, 0, Buffer.from("original"));
  };
  return {job, signal, input, observer, forward};
}

test("encoder port and post-assembly verification stay bound to the original full job", async () => {
  const state = fixture(), calls = [];
  state.observer.onEncode = async payload => {
    assert.ok(Object.isFrozen(payload)); assert.equal(payload.frameCount, 1);
    assert.equal(payload.signal, state.signal); assert.equal(payload.job, undefined);
    calls.push("encode"); return {encodeMs: 2};
  };
  state.observer.onAfterAssemble = async payload => {assert.equal(payload.outputPath, "output.mp4"); calls.push("verify");};
  await runObservedProducer(async () => {
    await state.forward();
    assert.deepEqual(await encodeObservedProducerStage(state.input), {encodeMs: 2});
    calls.push("SDK original audio/mux");
    await observeProducerAssembly(state.input);
  }, state.job, state.signal, state.observer);
  assert.deepEqual(calls, ["encode", "SDK original audio/mux", "verify"]);
});

test("invalid stage identity, missing stages, repeats and absorbed failures cannot publish success", async () => {
  for (const mode of ["job", "signal", "alpha", "frames", "fraction", "missing", "repeat", "result", "callback", "assembly", "verify"]) {
    const state = fixture();
    if (mode === "frames") state.job.duration = 1;
    if (mode === "fraction") state.job.config.fps = {num: 30000, den: 1001};
    if (mode === "result") state.observer.onEncode = async () => ({encodeMs: 1, success: true});
    if (mode === "callback") state.observer.onEncode = async () => {throw new Error("private detail");};
    if (mode === "verify") state.observer.onAfterAssemble = async () => {throw new Error("private detail");};
    await assert.rejects(runObservedProducer(async () => {
      await state.forward();
      const input = {...state.input};
      if (mode === "job") input.job = structuredClone(state.job);
      if (mode === "signal") input.abortSignal = new AbortController().signal;
      if (mode === "alpha") input.needsAlpha = true;
      try {
        await encodeObservedProducerStage(input);
        if (mode === "repeat") await encodeObservedProducerStage(input);
        if (mode !== "missing") await observeProducerAssembly({...input,
          ...(mode === "assembly" ? {outputPath: "another.mp4"} : {})});
      } catch {} // SDK swallowing errors must not clear the latched failure.
    }, state.job, state.signal, state.observer), /CONTROLLED_PRODUCER_OBSERVER_/);
  }
});

test("legacy jobs retain their original encode/assemble routes without stage callbacks", async () => {
  const state = fixture(); delete state.observer.onEncode; delete state.observer.onAfterAssemble;
  await runObservedProducer(async () => {
    await state.forward();
    assert.equal(await encodeObservedProducerStage(state.input), undefined);
    await observeProducerAssembly(state.input);
  }, state.job, state.signal, state.observer);
  state.observer.onEncode = async () => ({encodeMs: 1});
  await assert.rejects(runObservedProducer(async () => {}, state.job, state.signal, state.observer), /STAGE_CALLBACKS_INVALID/);
});

test("patched SDK encode stage invokes the host port after capture without entering its legacy encoder", async () => {
  const source = await readFile(new URL("./node_modules/@hyperframes/producer/dist/index.js", import.meta.url));
  const output = transformProducerExtension(source, "0.7.106").output.toString();
  const start = output.indexOf("async function runEncodeStage(input2) {");
  const body = output.slice(start, output.indexOf("// src/services/render/stages/assembleStage.ts", start));
  const encode = runInNewContext(`${body}\nrunEncodeStage`, {encodeObservedProducerStage});
  const state = fixture();
  await runObservedProducer(async () => {
    await state.forward();
    assert.deepEqual(await encode(state.input), {encodeMs: 1});
    await observeProducerAssembly(state.input);
  }, state.job, state.signal, state.observer);
});

test("patched SDK assembly keeps audio normalization/mux and verifies only after successful output", async () => {
  const source = await readFile(new URL("./node_modules/@hyperframes/producer/dist/index.js", import.meta.url));
  const output = transformProducerExtension(source, "0.7.106").output.toString();
  const start = output.indexOf("async function runAssembleStage(input2) {");
  const body = output.slice(start, output.indexOf("// src/services/renderOrchestrator.ts", start));
  for (const mode of ["audio", "silent", "failed"]) {
    const calls = [], state = fixture(); state.input.hasAudio = mode !== "silent";
    state.observer.onAfterAssemble = async () => {calls.push("verify");};
    const assemble = runInNewContext(`${body}\nrunAssembleStage`, {Date,
      updateJobStatus: () => {}, extname7: () => ".aac", observeProducerAssembly,
      padOrTrimAudioToVideoFrameCount: async () => {calls.push("normalize"); return {success: true, outputPath: "normalized", operation: "pad"};},
      muxVideoWithAudio: async (_video, audio, _output, _signal, options) => {
        assert.equal(audio, "normalized"); assert.equal(options.preserveAudioPrimingEditList, true);
        calls.push("mux"); return {success: mode !== "failed", error: "fixture"};},
      applyFaststart: async () => {calls.push("faststart"); return {success: true};}});
    const execute = () => runObservedProducer(async () => {
      await state.forward(); await encodeObservedProducerStage(state.input);
      await assemble({...state.input, audioOutputPath: "audio.aac", assertNotAborted: () => state.signal.throwIfAborted()});
    }, state.job, state.signal, state.observer);
    if (mode === "failed") {await assert.rejects(execute(), /Audio muxing failed/); assert.deepEqual(calls, ["normalize", "mux"]);}
    else {await execute(); assert.deepEqual(calls, mode === "audio" ? ["normalize", "mux", "verify"] : ["faststart", "verify"]);}
  }
});
