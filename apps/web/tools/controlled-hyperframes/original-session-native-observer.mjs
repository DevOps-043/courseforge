import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const {startOriginalSessionNativeCapture} = require(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-original-session-native-capture.js");
const {startOriginalSessionEventNativeCapture} = require(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-original-session-event-native-capture.js");
const {createOriginalSessionSeekCapture} = require(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-original-session-seek-capture.js");
const {createOriginalSessionFrameArchive} = require(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-original-session-frame-archive.js");

/** Host-fixed bridge; measurements run on the SDK's sessions, never a replacement page. */
export function createOriginalSessionNativeObserver(measurement, signal) {
  const captures = new WeakMap(), seeks = new WeakMap(), all = new Set();
  const frames = measurement.plan.contract.renderExecution?.sdrConversionPolicy ? createOriginalSessionFrameArchive({
    outputDirectory: measurement.outputDirectory, contract: measurement.plan.contract, signal, verifyFiles: measurement.assertUnchanged,
  }) : undefined;
  let original, originalSeek;
  return {observer: {
    async onSession({session, cdp}) {
      if (captures.has(session)) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_DUPLICATE");
      const start = measurement.plan.contract.checkpointBatch ? startOriginalSessionEventNativeCapture : startOriginalSessionNativeCapture;
      const capture = await start({cdp, serverUrl: session.serverUrl,
        document: measurement.plan.document, contract: measurement.plan.contract, fonts: measurement.plan.fonts,
        verifyFiles: measurement.assertUnchanged, signal});
      captures.set(session, capture); all.add(capture);
      if (measurement.plan.contract.renderExecution?.seekRepeatabilityPolicy) seeks.set(session,
        createOriginalSessionSeekCapture({document: measurement.plan.document, contract: measurement.plan.contract,
          signal, verifyFiles: measurement.assertUnchanged}));
    },
    async onBeforeFrame({session, frameIndex, quantizedTime}) {
      const capture = captures.get(session);
      if (!capture || original && original !== capture) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_CHANGED");
      original ??= capture;
      originalSeek ??= seeks.get(session);
      await capture.captureFrame(frameIndex, quantizedTime);
    },
    async onAfterFrame({session, frameIndex, quantizedTime, buffer, prepareFrame, captureFrame}) {
      const capture = captures.get(session);
      if (!capture || capture !== original) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_CHANGED");
      await frames?.captureFrame(frameIndex, quantizedTime, buffer);
      await capture.repeatAtLastCheckpoint(frameIndex, prepareFrame);
      await seeks.get(session)?.captureFrame(frameIndex, quantizedTime, buffer, captureFrame);
    },
  }, finalize() {
    if (!original) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_INCOMPLETE");
    return original.finalize();
  }, finalizeEvents() {
    if (!original) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_INCOMPLETE");
    return original.finalizeEvents?.();
  }, finalizeSeek() {
    if (!original) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_INCOMPLETE");
    return originalSeek?.finalize();
  }, async finalizeFrames() {
    if (!original) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_INCOMPLETE");
    return frames?.finalize();
  }, close() {
    let failure;
    for (const capture of all) {try {capture.close();} catch (error) {failure ??= error;}}
    all.clear();
    if (failure) throw failure;
  }};
}
