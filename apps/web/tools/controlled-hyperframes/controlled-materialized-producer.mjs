import {isAbsolute, relative, sep} from "node:path";
import {auditMaterializedProducerCapture} from "./materialized-producer-capture-audit.mjs";

export const MATERIALIZED_PRODUCER_POLICY = Object.freeze({
  id: "MATERIALIZED_FULL_PRODUCER_SDR_V1", workers: 1, quality: "high", format: "mp4",
});
const silentLogger = Object.freeze({error() {}, warn() {}, info() {}, debug() {}, isLevelEnabled: () => false});
const inside = (directory, path) => {
  const suffix = relative(directory, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
};

/** Operator-only pipeline adapter. Caller must provide OS containment and admitted installation.
 * Produces a candidate video, not a conformance report or a supervisor artifact. */
export async function renderMaterializedProducer(request, ports = {}) {
  const {directory, entryPath, outputPath, fps, producerConfig, signal} = request;
  if (![directory, entryPath, outputPath].every(path => typeof path === "string" && isAbsolute(path) && !path.includes("\0"))
    || entryPath === directory || !inside(directory, entryPath) || inside(directory, outputPath)
    || ![24, 25, 30, 60].includes(fps) || !producerConfig || typeof producerConfig !== "object"
    || Array.isArray(producerConfig) || !isAbsolute(producerConfig.chromePath ?? ""))
    throw new Error("CONTROLLED_RENDER_PRODUCER_INPUT_INVALID");
  if (!(signal instanceof AbortSignal)) throw new Error("CONTROLLED_RENDER_PRODUCER_SIGNAL_REQUIRED");
  // An observed execution requires an operator-supplied, admitted extension and all hooks.
  // Never import the uninstrumented SDK as a fallback when observation is requested.
  const observed = Object.hasOwn(ports, "observer");
  if (observed && (!ports.producer || typeof ports.producer.executeObservedRenderJob !== "function"
    || !ports.observer || !["onSession", "onBeforeFrame", "onAfterFrame"].every(key => typeof ports.observer[key] === "function")))
    throw new Error("CONTROLLED_RENDER_PRODUCER_OBSERVER_REQUIRED");
  signal.throwIfAborted();
  // No env-based resolution or SDK import until the host has admitted the request.
  const config = {
    fps: {num: fps, den: 1}, quality: MATERIALIZED_PRODUCER_POLICY.quality,
    format: MATERIALIZED_PRODUCER_POLICY.format, workers: MATERIALIZED_PRODUCER_POLICY.workers,
    useGpu: false, debug: false, strictness: "strict", videoFrameFormat: "png", hdrMode: "force-sdr",
    entryFile: relative(directory, entryPath), logger: silentLogger,
    producerConfig: {...structuredClone(producerConfig), concurrency: 1, enableBrowserPool: false,
      enableStreamingEncode: false,
      disableGpu: true, browserGpuMode: "software", forceScreenshot: true, useDrawElement: false,
      enableDrawElementWorkerEncode: false, staticFrameDedup: false},
  };
  try {
    const producer = ports.producer ?? await import("@hyperframes/producer");
    signal.throwIfAborted();
    const job = producer.createRenderJob(config);
    if (observed) await producer.executeObservedRenderJob(job, directory, outputPath, undefined, signal, ports.observer);
    else await producer.executeRenderJob(job, directory, outputPath, undefined, signal);
    signal.throwIfAborted();
    if (job.status !== "complete" || job.outcome !== "completed" || !Array.isArray(job.warnings)
      || job.warnings.length !== 0 || job.outputPath !== outputPath)
      throw new Error("CONTROLLED_RENDER_PRODUCER_RESULT_INVALID");
    // No SDK diagnostics, raw paths beyond the operator-selected output, or self-declared PASS.
    const capture = auditMaterializedProducerCapture(job.perfSummary?.observability?.capture);
    return {policy: MATERIALIZED_PRODUCER_POLICY.id, scope: "CANDIDATE_VIDEO_NOT_CONFORMANCE",
      videoPath: outputPath, capture};
  } catch (error) {
    if (signal.aborted) throw new Error("CONTROLLED_RENDER_ABORTED");
    if (error instanceof Error && ["CONTROLLED_RENDER_PRODUCER_RESULT_INVALID", "CONTROLLED_RENDER_PRODUCER_CAPTURE_MISMATCH"].includes(error.message)) throw error;
    throw new Error("CONTROLLED_RENDER_PRODUCER_FAILED");
  }
}
