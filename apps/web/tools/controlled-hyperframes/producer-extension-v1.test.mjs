import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {runInNewContext} from "node:vm";
import {createHash} from "node:crypto";
import {PRODUCER_EXTENSION_V1, transformProducerExtension} from "./producer-extension-v1.mjs";
import {runObservedProducer, observeProducerSession, guardProducerFrame,
  observeProducerBeforeFrame, observeProducerAfterFrame} from "./courseforge-producer-observer-v1.mjs";

const source = await readFile(new URL("./node_modules/@hyperframes/producer/dist/index.js", import.meta.url));
const transformed = transformProducerExtension(source, "0.7.106");
const configuration = () => ({config: {workers: 1, useGpu: false, hdrMode: "force-sdr",
  producerConfig: {concurrency: 1, enableBrowserPool: false, disableGpu: true,
    browserGpuMode: "software", forceScreenshot: true, useDrawElement: false,
    enableDrawElementWorkerEncode: false, staticFrameDedup: false}}});
const observer = overrides => ({onSession: async () => {}, onBeforeFrame: async () => {},
  onAfterFrame: async () => {}, ...overrides});
const session = () => ({page: {}, captureMode: "screenshot"});
const renderFrame = async current => {
  await observeProducerSession(current, async () => ({}));
  guardProducerFrame(current);
  await observeProducerBeforeFrame(current, 0, 0, 0);
  const original = Buffer.from("original capture");
  await observeProducerAfterFrame(current, 0, 0, 0, original);
  return original;
};

test("deterministic pinned transformation preserves all upstream bytes except six hooks and wrapper", () => {
  const output = transformed.output.toString("utf8");
  assert.deepEqual(transformed, transformProducerExtension(source, "0.7.106"));
  let restored = output.slice(output.indexOf("import { createRequire"), output.lastIndexOf("\nexport async function executeObservedRenderJob"));
  for (const line of [
    "  await observeProducerSession(session, () => getCdpSession(session.page));\n",
    "  guardProducerFrame(session);\n",
    "    await observeProducerBeforeFrame(session, frameIndex, time, quantizedTime);\n",
    "    await observeProducerAfterFrame(session, frameIndex, time, quantizedTime, screenshotBuffer, async (index, seconds, capture = false) => { const prepared = await prepareFrameForCapture(session, index, seconds); return { ...prepared, ...(capture ? { buffer: await pageScreenshotCapture(session.page, session.options) } : {}) }; });\n",
    "  const observedEncoding = await encodeObservedProducerStage(input2);\n  if (observedEncoding !== undefined) return observedEncoding;\n",
    "  await observeProducerAssembly(input2);\n",
  ]) {
    assert.equal(restored.split(line).length, 2);
    restored = restored.replace(line, "");
  }
  assert.deepEqual(Buffer.from(restored), source);
  assert.equal(transformed.manifest.scope, "ORIGINAL_SESSION_HOOKS_NOT_CONFORMANCE_OR_SANDBOX");
  assert.equal(createHash("sha256").update(transformed.output).digest("hex"), transformed.manifest.outputSha256);
  // Syntax only: never imports the real SDK or starts its pipeline.
  execFileSync(process.execPath, ["--check", "--input-type=module"], {input: transformed.output});
});

test("version, byte, size and repeated-transformation mismatch fail closed", () => {
  const drift = Buffer.from(source);
  drift[100] ^= 1;
  for (const [bytes, version] of [[source, "0.7.107"], [drift, "0.7.106"],
    [source.subarray(1), "0.7.106"], [transformed.output, "0.7.106"]])
    assert.throws(() => transformProducerExtension(bytes, version), /SOURCE_MISMATCH/);
  assert.equal(PRODUCER_EXTENSION_V1.bytes, source.length);
});

test("before-navigation hook is first initialization action and legacy entry does not acquire CDP", async () => {
  assert.ok(transformed.output.toString("utf8").includes(
    "async function initializeSession(session) {\n  await observeProducerSession(session, () => getCdpSession(session.page));\n  const { page, serverUrl } = session;"));
  let acquired = false;
  await observeProducerSession(session(), async () => {acquired = true; return {};});
  assert.equal(acquired, false);
});

test("failure acquiring original CDP is latched and aborted acquisition does not call observer", async () => {
  await assert.rejects(runObservedProducer(async () => {
    try {await observeProducerSession(session(), async () => {throw new Error("private CDP error");});} catch {}
    throw new Error("SDK wrapped private error");
  }, configuration(), new AbortController().signal, observer()),
  {message: "CONTROLLED_PRODUCER_OBSERVER_SESSION_INVALID"});
  const controller = new AbortController();
  let called = false;
  await assert.rejects(runObservedProducer(async () => {
    await observeProducerSession(session(), async () => {controller.abort(); return {};});
  }, configuration(), controller.signal, observer({onSession: async () => {called = true;}})), {name: "AbortError"});
  assert.equal(called, false);
});

test("callbacks receive original session, settled frame and copy of the captured bytes", async () => {
  const current = session();
  const events = [];
  const bytes = await runObservedProducer(() => renderFrame(current), configuration(), new AbortController().signal,
    observer({onSession: async payload => {assert.equal(payload.session, current); events.push("session");},
      onBeforeFrame: async () => events.push("before"),
      onAfterFrame: async payload => {
        assert.equal(payload.sha256, createHash("sha256").update("original capture").digest("hex"));
        payload.buffer.fill(0);
        events.push("after");
      }}));
  assert.equal(bytes.toString(), "original capture");
  assert.deepEqual(events, ["session", "before", "after"]);
});

test("original prepare lease reuses SDK preparation and restores the captured frame before returning", async () => {
  const current = session(), calls = []; let escaped;
  await runObservedProducer(async () => {
    await observeProducerSession(current, async () => ({}));
    await observeProducerBeforeFrame(current, 10, 1, 1);
    await observeProducerAfterFrame(current, 10, 1, 1, Buffer.from("original"), async (index, seconds) => {
      calls.push([index, seconds]); return {quantizedTime: seconds, seekMs: 42};
    });
  }, configuration(), new AbortController().signal, observer({onAfterFrame: async payload => {
    escaped = payload.prepareFrame;
    assert.deepEqual(await payload.prepareFrame(2, 0.2), {quantizedTime: 0.2});
    assert.deepEqual(await payload.prepareFrame(0, 0), {quantizedTime: 0});
  }}));
  assert.deepEqual(calls, [[2, 0.2], [0, 0], [10, 1]]);
  await assert.rejects(escaped(0, 0), /CLOSED/);
  assert.equal(calls.length, 3);
});

test("original capture lease returns independent bytes, restores position and rejects missing screenshots", async () => {
  for (const missing of [false, true]) {
    const current = session(), calls = [], bytes = Buffer.from("reverse image"); let escaped;
    const execute = () => runObservedProducer(async () => {
      await observeProducerSession(current, async () => ({}));
      await observeProducerBeforeFrame(current, 10, 1, 1);
      await observeProducerAfterFrame(current, 10, 1, 1, Buffer.from("forward"), async (index, seconds, capture) => {
        calls.push([index, seconds, capture]); return {quantizedTime: seconds, ...(capture && !missing ? {buffer: bytes} : {})};
      });
    }, configuration(), new AbortController().signal, observer({onAfterFrame: async ({captureFrame}) => {
      escaped = captureFrame;
      const result = await captureFrame(2, 0.2); result.buffer.fill(0);
    }}));
    if (missing) await assert.rejects(execute(), /CAPTURE_INVALID/);
    else {
      await execute();
      assert.equal(bytes.toString(), "reverse image");
      assert.deepEqual(calls, [[2, 0.2, true], [10, 1, undefined]]);
      await assert.rejects(escaped(0, 0), /CLOSED/);
    }
  }
});

test("invalid preparation, SDK failure and restoration drift stay latched even if absorbed", async () => {
  for (const mode of ["future", "negative", "SDK", "restore"]) {
    const current = session(); let calls = 0;
    await assert.rejects(runObservedProducer(async () => {
      await observeProducerSession(current, async () => ({}));
      await observeProducerBeforeFrame(current, 10, 1, 1);
      try {
        await observeProducerAfterFrame(current, 10, 1, 1, Buffer.from("original"), async (_index, seconds) => {
          if (mode === "SDK") throw new Error("private preparation info");
          return {quantizedTime: ++calls === 2 && mode === "restore" ? 99 : seconds};
        });
      } catch {} // Emulate an SDK path swallowing the observer failure.
    }, configuration(), new AbortController().signal, observer({onAfterFrame: async ({prepareFrame}) => {
      await prepareFrame(mode === "future" ? 11 : mode === "negative" ? -1 : 0, 0);
    }})), /CONTROLLED_PRODUCER_OBSERVER_(PREPARE|RESTORE)/);
  }
});

test("callback failure cannot become success if the SDK absorbs it", async () => {
  await assert.rejects(runObservedProducer(async () => {
    try { await renderFrame(session()); } catch {}
    return "SDK reported complete";
  }, configuration(), new AbortController().signal,
  observer({onAfterFrame: async () => {throw new Error("private provider diagnostics");}})),
  error => error.message === "CONTROLLED_PRODUCER_OBSERVER_CALLBACK_FAILED");
});

test("effective dedup or capture-mode drift remains latched even if the SDK retries", async () => {
  for (const drift of [{staticFrames: new Set()}, {captureMode: "beginframe"}]) {
    await assert.rejects(runObservedProducer(async () => {
      const current = session();
      await observeProducerSession(current, async () => ({}));
      Object.assign(current, drift);
      try {guardProducerFrame(current);} catch {}
      await renderFrame(session());
    }, configuration(), new AbortController().signal, observer()), /SESSION_INVALID/);
  }
});

test("requires full profile, callbacks, captured frames and matching before/after", async () => {
  const invalid = configuration();
  invalid.config.producerConfig.enableBrowserPool = true;
  await assert.rejects(runObservedProducer(async () => {}, invalid, new AbortController().signal, observer()), /PROFILE_INVALID/);
  await assert.rejects(runObservedProducer(async () => {}, configuration(), new AbortController().signal, {}), /INPUT_INVALID/);
  await assert.rejects(runObservedProducer(async () => {}, configuration(), new AbortController().signal, observer()), /NO_FRAMES/);
  await assert.rejects(runObservedProducer(async () => {
    const current = session();
    await renderFrame(current);
    await observeProducerBeforeFrame(current, 1, 1, 1);
  }, configuration(), new AbortController().signal, observer()), /FRAME_INCOMPLETE/);
  await assert.rejects(runObservedProducer(async () => {
    const current = session();
    await observeProducerSession(current, async () => ({}));
    await observeProducerBeforeFrame(current, 0, 0, 0);
    await observeProducerAfterFrame(current, 1, 0, 0, Buffer.from("frame"));
  }, configuration(), new AbortController().signal, observer()), /FRAME_SEQUENCE_INVALID/);
});

test("abort prevents pipeline entry and late completion", async () => {
  const before = new AbortController();
  before.abort();
  let entered = false;
  await assert.rejects(runObservedProducer(async () => {entered = true;}, configuration(), before.signal, observer()));
  assert.equal(entered, false);
  const late = new AbortController();
  await assert.rejects(runObservedProducer(async () => {
    await renderFrame(session());
    late.abort();
  }, configuration(), late.signal, observer()), {name: "AbortError"});
});

test("concurrent executions do not mix observers", async () => {
  const seen = [[], []];
  await Promise.all(seen.map((events, index) => {
    const current = session();
    current.owner = index;
    return runObservedProducer(() => renderFrame(current), configuration(), new AbortController().signal,
      observer({onSession: async ({session: captured}) => {
        await new Promise(resolve => setImmediate(resolve));
        events.push(captured.owner);
      }, onAfterFrame: async ({session: captured}) => events.push(captured.owner)}));
  }));
  assert.deepEqual(seen, [[0, 0], [1, 1]]);
});

test("actual patched capture function orders seek/media preparation before observation and screenshot", async () => {
  const bundle = transformed.output.toString("utf8");
  const start = bundle.indexOf("async function captureFrameCore(");
  const end = bundle.indexOf("\nasync function captureFrame(", start);
  assert.ok(start > 0 && end > start);
  const events = [];
  const current = {...session(), options: {fps: {num: 30, den: 1}},
    capturePerf: {frames: 0, seekMs: 0, beforeCaptureMs: 0, screenshotMs: 0, totalMs: 0, frameMs: []}};
  const capture = runInNewContext(`${bundle.slice(start, end)}\ncaptureFrameCore`, {
    guardProducerFrame, observeProducerBeforeFrame, observeProducerAfterFrame,
    fpsToNumber: fps => fps.num / fps.den,
    prepareFrameForCapture: async (received, index, seconds) => {
      assert.equal(received, current); assert.equal(index, 0); assert.equal(seconds, 0);
      events.push("seek+media"); return {quantizedTime: 0, seekMs: 0, beforeCaptureMs: 0};
    },
    pageScreenshotCapture: async page => {assert.equal(page, current.page); events.push("screenshot"); return Buffer.from("PNG fixture");},
    captureFrameErrorDiagnostics: async () => {}, Buffer, Date,
  });
  await runObservedProducer(async () => {
    await observeProducerSession(current, async () => ({}));
    const result = await capture(current, 0, 0);
    assert.equal(result.buffer.toString(), "PNG fixture");
  }, configuration(), new AbortController().signal,
  observer({onBeforeFrame: async () => events.push("before"), onAfterFrame: async ({prepareFrame, captureFrame}) => {
    events.push("after"); await prepareFrame(0, 0);
    const repeated = await captureFrame(0, 0); assert.equal(repeated.buffer.toString(), "PNG fixture");
  }}));
  assert.deepEqual(events, ["seek+media", "before", "screenshot", "after", "seek+media", "seek+media", "screenshot", "seek+media"]);
});
