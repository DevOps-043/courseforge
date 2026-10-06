import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {renderMaterializedProducer} from "./controlled-materialized-producer.mjs";
import {auditMaterializedProducerCapture} from "./materialized-producer-capture-audit.mjs";
const capture = {forceScreenshot: true, captureMode: "screenshot", workerCount: 1, browserGpuMode: "software", hasHdrContent: false};
const request = () => ({directory: resolve("input"), entryPath: resolve("input/index.html"), outputPath: resolve("output/video.mp4"),
  fps: 25, producerConfig: {chromePath: resolve("browser.exe"), concurrency: "auto", browserGpuMode: "hardware"},
  signal: new AbortController().signal});
function fixture(work) {
  let calls = 0;
  return {producer: {createRenderJob(config) {return {config};},
    async executeRenderJob(job, directory, outputPath, progress, signal) {
      calls++; await work?.(job, directory, outputPath, progress, signal);
      Object.assign(job, {status: "complete", outcome: "completed", warnings: [], outputPath,
        perfSummary: {observability: {capture}}});
    }}, calls: () => calls};
}
test("full pipeline receives materialized paths, explicit SDR and no inherited auto/GPU defaults", async () => {
  const input = request(), original = structuredClone(input.producerConfig);
  const f = fixture((job, directory, outputPath, progress, signal) => {
    assert.equal(directory, input.directory); assert.equal(outputPath, input.outputPath);
    assert.equal(signal, input.signal); assert.equal(progress, undefined);
    assert.deepEqual(job.config.fps, {num: 25, den: 1});
    assert.equal(job.config.entryFile, "index.html"); assert.equal(job.config.strictness, "strict");
    assert.equal(job.config.hdrMode, "force-sdr"); assert.equal(job.config.videoFrameFormat, "png");
    assert.equal(job.config.producerConfig.concurrency, 1); assert.equal(job.config.producerConfig.forceScreenshot, true);
    assert.equal(job.config.producerConfig.enableBrowserPool, false); assert.equal(job.config.producerConfig.staticFrameDedup, false);
    job.config.logger.error("private diagnostic");
  });
  assert.deepEqual(await renderMaterializedProducer(input, f), {policy: "MATERIALIZED_FULL_PRODUCER_SDR_V1",
    scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE", videoPath: input.outputPath, capture: auditMaterializedProducerCapture(capture)});
  assert.deepEqual(input.producerConfig, original); assert.equal(f.calls(), 1);
});
test("invalid paths, nested output, unsupported fps and absent signal never execute", async () => {
  for (const patch of [{entryPath: resolve("elsewhere.html")}, {outputPath: resolve("input/video.mp4")},
    {entryPath: "index.html"}, {fps: 29.97}, {producerConfig: {}}, {signal: undefined}]) {
    const f = fixture(); await assert.rejects(renderMaterializedProducer({...request(), ...patch}, f));
    assert.equal(f.calls(), 0);
  }
});
test("pre-abort and late abort cannot return a candidate", async () => {
  for (const pre of [true, false]) {
    const controller = new AbortController(), input = {...request(), signal: controller.signal};
    if (pre) controller.abort();
    const f = fixture(() => controller.abort());
    await assert.rejects(renderMaterializedProducer(input, f)); assert.equal(f.calls(), pre ? 0 : 1);
  }
});
test("SDK warnings, failed outcomes and changed output never become success", async () => {
  for (const patch of [{warnings: [{}]}, {outcome: "completed_with_warnings"}, {status: "failed"}, {outputPath: resolve("other.mp4")}]) {
    await assert.rejects(renderMaterializedProducer(request(), {producer: {createRenderJob: () => ({}),
      async executeRenderJob(job, directory, outputPath) {
        Object.assign(job, {status: "complete", outcome: "completed", warnings: [], outputPath}, patch);
      }}}), /PRODUCER_RESULT_INVALID/);
  }
});
test("SDK private errors are replaced without retry", async () => {
  let calls = 0;
  await assert.rejects(renderMaterializedProducer(request(), {producer: {createRenderJob: () => ({}),
    async executeRenderJob() {calls++; throw new Error("private path or token");}}}),
  {message: "CONTROLLED_RENDER_PRODUCER_FAILED"});
  assert.equal(calls, 1);
});

test("missing or changed resolved capture strategy and runtime fallback cannot return a candidate", async () => {
  for (const changed of [undefined, {...capture, forceScreenshot: false}, {...capture, captureMode: "beginframe"},
    {...capture, workerCount: 2}, {...capture, browserGpuMode: "hardware"}, {...capture, hasHdrContent: true},
    {...capture, transientRetries: 1}, {...capture, deFallbackReason: "capture_error"}, {...capture, memoryExhaustionDetected: true}]) {
    await assert.rejects(renderMaterializedProducer(request(), {producer: {createRenderJob: () => ({}),
      async executeRenderJob(job, directory, outputPath) {
        Object.assign(job, {status: "complete", outcome: "completed", warnings: [], outputPath,
          perfSummary: {observability: {capture: changed}}});
      }}}), /PRODUCER_CAPTURE_MISMATCH/);
  }
});
