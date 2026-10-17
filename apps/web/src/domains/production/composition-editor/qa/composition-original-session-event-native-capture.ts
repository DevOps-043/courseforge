import {prepareCompositionEventBatchContracts} from "../composition-conformance-event-batch-contract";
import {compositionEditorDocumentSchema} from "../composition-document.types";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {startOriginalSessionNativeCapture} from "./composition-original-session-native-capture";

type CaptureInput = Parameters<typeof startOriginalSessionNativeCapture>[0];
type CapturePorts = Parameters<typeof startOriginalSessionNativeCapture>[1];
type Capture = Awaited<ReturnType<typeof startOriginalSessionNativeCapture>>;

/** All partitions observe one original session: complete forward sweep, then global reverse sweep. */
export async function startOriginalSessionEventNativeCapture(input: CaptureInput, ports: CapturePorts = {}) {
  const document = compositionEditorDocumentSchema.parse(input.document);
  const parentContract = compositionConformanceContractSchema.parse(input.contract);
  const prepared = prepareCompositionEventBatchContracts({document, parentContract});
  const entries: Array<{contract: ReturnType<typeof prepared.select>["contract"]; capture: Capture}> = [];
  let failure: Error | undefined, finished = false, busy = false, closed = false;
  const close = () => {
    closed = true;
    let error;
    for (const entry of entries) try {entry.capture.close();} catch (caught) {error ??= caught;}
    if (error) throw error;
  };
  const active = () => {
    input.signal.throwIfAborted();
    if (failure) throw failure;
    if (closed) throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_CLOSED");
  };
  try {
    for (let index = 0; index < prepared.batchCount; index++) {
      active();
      const {contract} = prepared.select(index);
      entries.push({contract, capture: await startOriginalSessionNativeCapture({...input, contract}, ports)});
    }
  } catch {close(); throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_START_FAILED");}
  const lastFrame = entries.at(-1)!.contract.checkpoints.at(-1)!.frameIndex;
  return {
    close,
    async captureFrame(frameIndex: number, quantizedTime: number) {
      if (finished) return;
      try {
        active();
        if (busy) throw new Error();
        busy = true;
        for (const {contract, capture} of entries) {
          if (frameIndex <= contract.checkpoints.at(-1)!.frameIndex)
            await capture.captureFrame(frameIndex, quantizedTime);
        }
      } catch {failure ??= new Error("CONTROLLED_RENDER_EVENT_NATIVE_CAPTURE_FAILED"); close(); throw failure;}
      finally {busy = false;}
    },
    async repeatAtLastCheckpoint(frameIndex: number, prepareFrame: Parameters<Capture["repeatCapturedCheckpoints"]>[0]) {
      if (finished || frameIndex !== lastFrame) return;
      try {
        active();
        if (busy) throw new Error();
        busy = true;
        for (let index = entries.length - 1; index >= 0; index--)
          await entries[index].capture.repeatCapturedCheckpoints(prepareFrame);
        await input.verifyFiles(); active();
        finished = true;
      } catch {failure ??= new Error("CONTROLLED_RENDER_EVENT_NATIVE_REPEAT_FAILED"); close(); throw failure;}
      finally {busy = false;}
    },
    finalize() {
      input.signal.throwIfAborted();
      if (failure) throw failure;
      if (!finished) throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_INCOMPLETE");
      return entries[0].capture.finalize();
    },
    finalizeEvents() {
      input.signal.throwIfAborted();
      if (failure) throw failure;
      if (!finished) throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_INCOMPLETE");
      return {scope: "SDK_SESSION_PARTITION_NATIVE_NOT_PREVIEW_PARITY" as const,
        parentContractSha256: prepared.parentContractSha256, planSha256: prepared.planSha256,
        batches: entries.map(({capture}, index) => ({batchIndex: index,
          contractSha256: prepared.select(index).batchContractSha256, nativeEvidence: capture.finalize()}))};
    },
  };
}
