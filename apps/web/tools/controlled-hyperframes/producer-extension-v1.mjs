import {createHash} from "node:crypto";

export const PRODUCER_EXTENSION_V1 = Object.freeze({
  id: "COURSEFORGE_ORIGINAL_SESSION_OBSERVER_V4", version: "0.7.106", bytes: 9931212,
  sourceSha256: "f9dbd087025acb3e18d262ea66c0c2dcee72e3143952894f30ba5f0e3b56e94e",
  scope: "ORIGINAL_SESSION_HOOKS_NOT_CONFORMANCE_OR_SANDBOX",
});

const hooks = Object.freeze([
  ["async function initializeSession(session) {\n",
    "  await observeProducerSession(session, () => getCdpSession(session.page));\n"],
  ["async function captureFrameCore(session, frameIndex, time) {\n",
    "  guardProducerFrame(session);\n"],
  ["    const screenshotStart = Date.now();\n",
    "    await observeProducerBeforeFrame(session, frameIndex, time, quantizedTime);\n"],
  ["    return { buffer: screenshotBuffer, quantizedTime, captureTimeMs };\n",
    "    await observeProducerAfterFrame(session, frameIndex, time, quantizedTime, screenshotBuffer, async (index, seconds, capture = false) => { const prepared = await prepareFrameForCapture(session, index, seconds); return { ...prepared, ...(capture ? { buffer: await pageScreenshotCapture(session.page, session.options) } : {}) }; });\n"],
  ["async function runEncodeStage(input2) {\n",
    "  const observedEncoding = await encodeObservedProducerStage(input2);\n  if (observedEncoding !== undefined) return observedEncoding;\n"],
  ["  return { assembleMs: Date.now() - stage6Start };\n",
    "  await observeProducerAssembly(input2);\n"],
]);
const prefix = `// Courseforge modification: original-session observer v4; upstream Apache-2.0 license retained by packaging.
import {runObservedProducer, observeProducerSession, guardProducerFrame, observeProducerBeforeFrame, observeProducerAfterFrame, encodeObservedProducerStage, observeProducerAssembly} from "./courseforge-producer-observer-v1.mjs";
`;
const suffix = `
export async function executeObservedRenderJob(job, projectDir, outputPath, progressSink, abortSignal, observer) {
  return runObservedProducer(() => executeRenderJob(job, projectDir, outputPath, progressSink, abortSignal), job, abortSignal, observer);
}
`;

/** Pure build recipe: never writes installed vendor files or imports/executes the SDK. */
export function transformProducerExtension(source, version) {
  if (!Buffer.isBuffer(source) || version !== PRODUCER_EXTENSION_V1.version
    || source.length !== PRODUCER_EXTENSION_V1.bytes
    || createHash("sha256").update(source).digest("hex") !== PRODUCER_EXTENSION_V1.sourceSha256)
    throw new Error("CONTROLLED_PRODUCER_EXTENSION_SOURCE_MISMATCH");
  let transformed = source.toString("utf8");
  for (const [anchor, insertion] of hooks) {
    if (transformed.split(anchor).length !== 2) throw new Error("CONTROLLED_PRODUCER_EXTENSION_ANCHOR_MISMATCH");
    transformed = anchor.includes("return { buffer:") || anchor.includes("screenshotStart") || anchor.includes("return { assembleMs:")
      ? transformed.replace(anchor, insertion + anchor)
      : transformed.replace(anchor, anchor + insertion);
  }
  const output = Buffer.from(prefix + transformed + suffix, "utf8");
  return Object.freeze({output, manifest: Object.freeze({...PRODUCER_EXTENSION_V1,
    outputBytes: output.length, outputSha256: createHash("sha256").update(output).digest("hex")})});
}
