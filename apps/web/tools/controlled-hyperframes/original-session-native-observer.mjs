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
const {createOriginalSessionHtmlLayoutCapture} = require(
  "./dist/composition-worker/domains/production/composition-editor/qa/composition-html-layout-capture.js");

/** Host-fixed bridge; measurements run on the SDK's sessions, never a replacement page. */
export function createOriginalSessionNativeObserver(measurement, signal) {
  const captures = new WeakMap(), seeks = new WeakMap(), layouts = new WeakMap(), all = new Set();
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
      const layout = createOriginalSessionHtmlLayoutCapture({cdp, document: measurement.plan.document, signal});
      layouts.set(session, layout); all.add(layout);
      if (measurement.plan.contract.renderExecution?.seekRepeatabilityPolicy) seeks.set(session,
        createOriginalSessionSeekCapture({document: measurement.plan.document, contract: measurement.plan.contract,
          signal, verifyFiles: measurement.assertUnchanged}));
    },
    async onBeforeFrame({session, frameIndex, quantizedTime}) {
      const capture = captures.get(session);
      if (!capture || original && original !== capture) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_CHANGED");
      original ??= capture;
      originalSeek ??= seeks.get(session);
      await layouts.get(session).assert();
      await capture.captureFrame(frameIndex, quantizedTime);
    },
    async onAfterFrame({session, frameIndex, quantizedTime, buffer, prepareFrame, captureFrame}) {
      const capture = captures.get(session);
      if (!capture || capture !== original) throw new Error("CONTROLLED_RENDER_NATIVE_SESSION_CHANGED");
      const layout = layouts.get(session);
      await layout.assert();
      await frames?.captureFrame(frameIndex, quantizedTime, buffer);
      const prepareChecked = layout.required ? async (index, seconds) => {
        const prepared = await prepareFrame(index, seconds);
        await layout.assert();
        return prepared;
      } : prepareFrame;
      const captureChecked = layout.required ? async (index, seconds) => {
        // The existing screenshot lease prepares again internally. Check both
        // sides and discard invalid bytes before any evidence consumer reads them.
        await prepareChecked(index, seconds);
        const captured = await captureFrame(index, seconds);
        await layout.assert();
        return captured;
      } : captureFrame;
      await capture.repeatAtLastCheckpoint(frameIndex, prepareChecked);
      await seeks.get(session)?.captureFrame(frameIndex, quantizedTime, buffer, captureChecked);
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
