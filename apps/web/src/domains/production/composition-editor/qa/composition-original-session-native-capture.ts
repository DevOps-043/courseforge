import {compositionEditorDocumentSchema} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {borrowProducerCdpChannel, type ProducerCdpChannel} from "./composition-borrowed-producer-cdp";
import {startOriginalSessionFontCapture} from "./composition-original-session-font-capture";
import {captureTextParityCheckpoint} from "./composition-text-checkpoint-capture";
import {textCheckpointEvidenceSchema, validateTextParityEvidence, TEXT_PARITY_REPEATABILITY,
  type TextParityEvidence} from "./composition-text-parity-evidence";
import {COMPOSITION_TEXT_PARITY_POLICY} from "../composition-text-parity-policy";

type PrepareFrame = (index: number, seconds: number) => Promise<{quantizedTime: number}>;

/** Started before navigation; reads settled SDK checkpoints and repeats them using its original preparation lease. */
export async function startOriginalSessionNativeCapture(input: {
  cdp: ProducerCdpChannel; serverUrl: string; document: unknown; contract: unknown;
  fonts: unknown; verifyFiles: () => Promise<void>; signal: AbortSignal;
}, ports: {captureCheckpoint?: typeof captureTextParityCheckpoint} = {}) {
  const document = compositionEditorDocumentSchema.parse(input.document);
  const contract = compositionConformanceContractSchema.parse(input.contract);
  if (contract.schemaVersion !== 4 || !contract.renderExecution || contract.documentHash !== hashCompositionDocument(document))
    throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_PLAN_INVALID");
  const client = borrowProducerCdpChannel(input.cdp, input.signal);
  let fontCapture: Awaited<ReturnType<typeof startOriginalSessionFontCapture>> | undefined;
  try {
    if (contract.fontUsageContract?.bindings.length) fontCapture = await startOriginalSessionFontCapture(input);
  } catch (error) {client.close(); throw error;}
  const captureCheckpoint = ports.captureCheckpoint ?? captureTextParityCheckpoint;
  const points: TextParityEvidence["checkpoints"] = [];
  let failure: Error | undefined, finished = false, closed = false, busy = false;
  let evidence: {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY";
    textEvidence: TextParityEvidence; fontEvidence?: Awaited<ReturnType<NonNullable<typeof fontCapture>["finish"]>>} | undefined;
  const close = () => {
    closed = true;
    try {fontCapture?.close();} finally {client.close();}
  };
  const active = () => {
    if (failure) throw failure;
    input.signal.throwIfAborted();
    if (closed) throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_CLOSED");
  };
  const read = async (plan: typeof contract.textParity.checkpoints[number]) => {
    await input.verifyFiles(); active();
    const point = textCheckpointEvidenceSchema.parse({...await captureCheckpoint(client, document, plan.timeSeconds,
      contract.textParity.visibilityPolicy ?? false), frameIndex: plan.frameIndex, timeSeconds: plan.timeSeconds});
    if (point.status !== "CAPTURED" || JSON.stringify(point.expectedTexts) !== JSON.stringify(plan.expectedTexts))
      throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_TEXT_INVALID");
    return point;
  };
  const capture = {
    close,
    async captureFrame(frameIndex: number, quantizedTime: number) {
      if (finished) return;
      try {
        active();
        if (busy) throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_CONCURRENT");
        const plan = contract.textParity.checkpoints[points.length];
        if (!plan || frameIndex > plan.frameIndex) throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_CHECKPOINT_MISSING");
        if (frameIndex < plan.frameIndex) return;
        if (quantizedTime !== Math.round(plan.timeSeconds * contract.canvas.fps) / contract.canvas.fps)
          throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_TIME_INVALID");
        busy = true;
        const point = await read(plan);
        await fontCapture?.capture(point);
        points.push(point);
      } catch {
        failure ??= new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_FAILED"); close(); throw failure;
      } finally {busy = false;}
    },
    async repeatAtLastCheckpoint(frameIndex: number, prepareFrame: PrepareFrame) {
      if (finished || frameIndex !== contract.textParity.checkpoints.at(-1)?.frameIndex) return;
      await capture.repeatCapturedCheckpoints(prepareFrame);
    },
    async repeatCapturedCheckpoints(prepareFrame: PrepareFrame) {
      if (finished) return;
      try {
        active();
        if (busy || points.length !== contract.textParity.checkpoints.length || typeof prepareFrame !== "function")
          throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_REPEAT_REQUIRED");
        busy = true;
        for (let index = points.length - 1; index >= 0; index--) {
          const plan = contract.textParity.checkpoints[index];
          const prepared = await prepareFrame(plan.frameIndex, plan.timeSeconds); active();
          if (prepared.quantizedTime !== Math.round(plan.timeSeconds * contract.canvas.fps) / contract.canvas.fps)
            throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_REPEAT_TIME_INVALID");
          const repeated = await read(plan);
          if (JSON.stringify(repeated) !== JSON.stringify(points[index]))
            throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_REPEAT_DRIFT");
          await fontCapture?.verifyRepeat(repeated);
        }
        const textEvidence = validateTextParityEvidence({schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
          repeatability: TEXT_PARITY_REPEATABILITY, checkpoints: points}, contract, "RENDERER_GEOMETRY");
        const fontEvidence = await fontCapture?.finish(textEvidence);
        await input.verifyFiles(); active();
        evidence = {scope: "SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY", textEvidence,
          ...(fontEvidence ? {fontEvidence} : {})};
        finished = true;
        close();
      } catch {
        failure ??= new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_REPEAT_FAILED"); close(); throw failure;
      } finally {busy = false;}
    },
    finalize() {
      input.signal.throwIfAborted();
      if (failure) throw failure;
      if (!finished || !evidence) throw new Error("CONTROLLED_RENDER_NATIVE_CAPTURE_INCOMPLETE");
      return structuredClone(evidence);
    },
  };
  return capture;
}
