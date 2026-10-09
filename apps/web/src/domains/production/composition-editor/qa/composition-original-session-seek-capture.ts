import {createHash} from "node:crypto";
import sharp from "sharp";
import {compositionEditorDocumentSchema} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {prepareCompositionEventBatchContracts} from "../composition-conformance-event-batch-contract";
import {CONTROLLED_SEEK_LIMITS, CONTROLLED_SEEK_POLICY, controlledSeekRepeatabilityReportSchema} from "../composition-render-seek-policy";

/** Incremental original screenshots: retain hashes, not full frames; no preview or encoded-video claim. */
export function createOriginalSessionSeekCapture(input: {document: unknown; contract: unknown; signal: AbortSignal;
  verifyFiles: () => Promise<void>}) {
  const document = compositionEditorDocumentSchema.parse(input.document);
  const root = compositionConformanceContractSchema.parse(input.contract);
  if (root.schemaVersion !== 4 || root.documentHash !== hashCompositionDocument(document)
    || root.renderExecution?.seekRepeatabilityPolicy !== CONTROLLED_SEEK_POLICY)
    throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_POLICY_REQUIRED");
  const prepared = root.checkpointBatch ? prepareCompositionEventBatchContracts({document, parentContract: root}) : undefined;
  const contracts = prepared ? Array.from({length: prepared.batchCount}, (_, index) => prepared.select(index).contract) : [root];
  const points = contracts.flatMap((contract, batchIndex) => contract.checkpoints.map(point => ({...point, batchIndex})));
  if (root.canvas.width * root.canvas.height > CONTROLLED_SEEK_LIMITS.pixels || points.some((point, index) =>
    index > 0 && point.frameIndex <= points[index - 1].frameIndex)) throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_PLAN_INVALID");
  const samples = contracts.map(() => [] as Array<{frameIndex: number; timeSeconds: number; rgbaSha256: string}>);
  const byteCounts = contracts.map(() => ({forward: 0, reverse: 0}));
  const total = {forward: 0, reverse: 0};
  let next = 0, busy = false, finished = false, failure: Error | undefined;
  const active = () => {input.signal.throwIfAborted(); if (failure) throw failure;};
  const read = async (png: Buffer, batchIndex: number, direction: "forward" | "reverse") => {
    active(); await input.verifyFiles(); active();
    if (!Buffer.isBuffer(png) || !png.length || png.length > CONTROLLED_SEEK_LIMITS.pngBytes)
      throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_BYTES_INVALID");
    total[direction] += png.length; byteCounts[batchIndex][direction] += png.length;
    if (total[direction] > CONTROLLED_SEEK_LIMITS.sweepBytes) throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_BYTE_LIMIT");
    const image = sharp(png, {limitInputPixels: CONTROLLED_SEEK_LIMITS.pixels});
    const metadata = await image.metadata();
    if (metadata.format !== "png" || metadata.width !== root.canvas.width || metadata.height !== root.canvas.height)
      throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_IMAGE_INVALID");
    const bytes = await image.ensureAlpha().raw().toBuffer(); active();
    return createHash("sha256").update(bytes).digest("hex");
  };
  return {
    async captureFrame(frameIndex: number, quantizedTime: number, png: Buffer,
      captureOriginal: (index: number, seconds: number) => Promise<{quantizedTime: number; buffer: Buffer}>) {
      if (finished) return;
      try {
        active(); if (busy) throw new Error(); busy = true;
        const point = points[next];
        if (!point || frameIndex > point.frameIndex) throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_CHECKPOINT_MISSING");
        if (frameIndex < point.frameIndex) return;
        if (quantizedTime !== Math.round(point.timeSeconds * root.canvas.fps) / root.canvas.fps) throw new Error();
        const rgbaSha256 = await read(png, point.batchIndex, "forward");
        samples[point.batchIndex].push({frameIndex: point.frameIndex, timeSeconds: point.timeSeconds, rgbaSha256});
        next++;
        if (next !== points.length) return;
        if (typeof captureOriginal !== "function") throw new Error();
        for (let index = points.length - 1; index >= 0; index--) {
          const reverse = points[index];
          const captured = await captureOriginal(reverse.frameIndex, reverse.timeSeconds); active();
          if (captured.quantizedTime !== Math.round(reverse.timeSeconds * root.canvas.fps) / root.canvas.fps) throw new Error();
          const actual = await read(captured.buffer, reverse.batchIndex, "reverse");
          if (samples[reverse.batchIndex].find(sample => sample.frameIndex === reverse.frameIndex)?.rgbaSha256 !== actual)
            throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_REVERSE_MISMATCH");
        }
        await input.verifyFiles(); active(); finished = true;
      } catch {failure ??= new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_CAPTURE_FAILED"); throw failure;}
      finally {busy = false;}
    },
    finalize() {
      active(); if (!finished) throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_INCOMPLETE");
      const reports = contracts.map((contract, index) => controlledSeekRepeatabilityReportSchema.parse({
        policy: CONTROLLED_SEEK_POLICY, scope: "SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION", status: "PASS",
        documentHash: contract.documentHash, contractSha256: createHash("sha256").update(JSON.stringify(contract)).digest("hex"),
        checkpointCount: samples[index].length, byteCounts: byteCounts[index], samples: samples[index],
      }));
      return structuredClone({seekRepeatability: reports[0], ...(prepared ? {eventSeekRepeatability: reports} : {})});
    },
  };
}
