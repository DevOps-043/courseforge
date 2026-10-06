import {createHash} from "node:crypto";
import sharp from "sharp";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {CONTROLLED_SEEK_LIMITS, CONTROLLED_SEEK_POLICY, controlledSeekRepeatabilityReportSchema} from "../composition-render-seek-policy";
import {assertCompositionEventCheckpointBatch} from "../composition-conformance-batch-identity";
import {buildCompositionEventCheckpointPlan} from "../composition-conformance-event-checkpoints";
import type {CompositionEditorDocument} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
export {CONTROLLED_SEEK_LIMITS} from "../composition-render-seek-policy";

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Actual SDK session captures, not preview parity, encoded-frame identity or authorized job attestation. */
export async function measureControlledSeekRepeatability(input: {
  contract: unknown; capture: (frameIndex: number, timeSeconds: number) => Promise<Buffer>;
  signal?: AbortSignal;
}) {
  return (await measureSweeps([compositionConformanceContractSchema.parse(input.contract)],
    (_batchIndex, frameIndex, timeSeconds) => input.capture(frameIndex, timeSeconds), input.signal))[0]!;
}

/** Complete native event plan, one global forward sweep followed by its exact reverse. */
export async function measureControlledEventSeekRepeatability(input: {document: CompositionEditorDocument;
  contracts: unknown[]; capture: (batchIndex: number, frameIndex: number, timeSeconds: number) => Promise<Buffer>;
  signal?: AbortSignal}) {
  const plan = buildCompositionEventCheckpointPlan(input.document);
  if (!Array.isArray(input.contracts) || input.contracts.length !== plan.batches.length)
    throw new Error("CONTROLLED_RENDER_SEEK_BATCH_COVERAGE_INVALID");
  const contracts = input.contracts.map(contract => compositionConformanceContractSchema.parse(contract));
  const root = contracts[0]!;
  if (root.schemaVersion !== 4) throw new Error("CONTROLLED_RENDER_SEEK_BATCH_BINDING_INVALID");
  const documentHash = hashCompositionDocument(input.document);
  for (const [index, contract] of contracts.entries()) {
    if (contract.schemaVersion !== 4 || contract.checkpointBatch?.batchIndex !== index)
      throw new Error("CONTROLLED_RENDER_SEEK_BATCH_COVERAGE_INVALID");
    assertCompositionEventCheckpointBatch(input.document, contract);
    // Different batches cannot change the document or execution baseline mid-sweep.
    if (contract.documentHash !== documentHash
      || contract.canvas.width !== input.document.canvas.width || contract.canvas.height !== input.document.canvas.height
      || contract.canvas.fps !== input.document.canvas.fps || contract.canvas.durationSeconds !== input.document.canvas.durationSeconds
      || JSON.stringify(contract.renderExecution) !== JSON.stringify(root.renderExecution))
      throw new Error("CONTROLLED_RENDER_SEEK_BATCH_BINDING_INVALID");
  }
  return measureSweeps(contracts, input.capture, input.signal);
}

async function measureSweeps(contracts: ReturnType<typeof compositionConformanceContractSchema.parse>[],
  capture: (batchIndex: number, frameIndex: number, timeSeconds: number) => Promise<Buffer>, signal?: AbortSignal) {
  const checkpoints = contracts.flatMap((contract, batchIndex) => {
    if (!contract.checkpoints.length || contract.checkpoints.length > CONTROLLED_SEEK_LIMITS.checkpointCount
      || contract.canvas.width * contract.canvas.height > CONTROLLED_SEEK_LIMITS.pixels)
      throw new Error("CONTROLLED_RENDER_SEEK_PLAN_INVALID");
    return [...contract.checkpoints].sort((left, right) => left.frameIndex - right.frameIndex)
      .map(point => ({...point, batchIndex}));
  });
  if (new Set(checkpoints.map(point => point.frameIndex)).size !== checkpoints.length)
    throw new Error("CONTROLLED_RENDER_SEEK_PLAN_INVALID");
  for (const point of checkpoints) {
    const contract = contracts[point.batchIndex]!;
    if (point.frameIndex < 0 || point.timeSeconds < 0 || point.timeSeconds > contract.canvas.durationSeconds
      || Math.abs(point.timeSeconds - point.frameIndex / contract.canvas.fps) > 1e-6)
      throw new Error("CONTROLLED_RENDER_SEEK_PLAN_INVALID");
  }
  const samples = contracts.map(() => new Map<number, {frameIndex: number; timeSeconds: number; rgbaSha256: string}>());
  const byteCounts = {forward: 0, reverse: 0};
  const batchByteCounts = contracts.map(() => ({forward: 0, reverse: 0}));
  for (const direction of ["forward", "reverse"] as const) {
    const sweep = direction === "forward" ? checkpoints : [...checkpoints].reverse();
    for (const point of sweep) {
      const contract = contracts[point.batchIndex]!;
      if (signal?.aborted) throw new Error("CONTROLLED_RENDER_SEEK_CANCELLED");
      let png: Buffer;
      try {png = await capture(point.batchIndex, point.frameIndex, point.timeSeconds);}
      catch {throw new Error("CONTROLLED_RENDER_SEEK_CAPTURE_FAILED");}
      if (signal?.aborted) throw new Error("CONTROLLED_RENDER_SEEK_CANCELLED");
      if (!Buffer.isBuffer(png) || !png.length || png.length > CONTROLLED_SEEK_LIMITS.pngBytes)
        throw new Error("CONTROLLED_RENDER_SEEK_BYTES_INVALID");
      byteCounts[direction] += png.length;
      batchByteCounts[point.batchIndex]![direction] += png.length;
      if (byteCounts[direction] > CONTROLLED_SEEK_LIMITS.sweepBytes)
        throw new Error("CONTROLLED_RENDER_SEEK_BYTE_LIMIT");
      let rgba: Buffer;
      try {
        const image = sharp(png, {limitInputPixels: CONTROLLED_SEEK_LIMITS.pixels});
        const metadata = await image.metadata();
        if (metadata.format !== "png" || metadata.width !== contract.canvas.width || metadata.height !== contract.canvas.height)
          throw new Error("Invalid frame");
        rgba = await image.ensureAlpha().raw().toBuffer();
      } catch {throw new Error("CONTROLLED_RENDER_SEEK_IMAGE_INVALID");}
      const rgbaSha256 = digest(rgba);
      if (signal?.aborted) throw new Error("CONTROLLED_RENDER_SEEK_CANCELLED");
      if (direction === "forward") samples[point.batchIndex]!.set(point.frameIndex, {...point, rgbaSha256});
      else if (samples[point.batchIndex]!.get(point.frameIndex)?.rgbaSha256 !== rgbaSha256)
        throw new Error("CONTROLLED_RENDER_SEEK_REVERSE_MISMATCH");
    }
  }
  return contracts.map((contract, index) => controlledSeekRepeatabilityReportSchema.parse({policy: CONTROLLED_SEEK_POLICY,
    scope: "SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION" as const,
    status: "PASS" as const, documentHash: contract.documentHash, contractSha256: digest(JSON.stringify(contract)),
    checkpointCount: samples[index]!.size, byteCounts: batchByteCounts[index],
    samples: [...samples[index]!.values()].map(({frameIndex, timeSeconds, rgbaSha256}) =>
      ({frameIndex, timeSeconds, rgbaSha256}))}));
}
