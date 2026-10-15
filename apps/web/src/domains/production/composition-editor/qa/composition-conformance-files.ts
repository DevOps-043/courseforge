import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  compositionConformanceContractSchema,
  evaluateCompositionConformance,
  measureCompositionConformanceTemporalDriftMs,
  type CompositionConformanceReport,
  type CompositionConformanceSample,
} from "../composition-preview-render-conformance";
import { measureFrameSsim } from "./composition-frame-ssim";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import { textParityEvidenceSchema, validateTextParityEvidence, assertRequiredTextPaintMaskEvidence } from "./composition-text-parity-evidence";
import { compareTextParityRegions } from "./composition-text-region-comparison";
import type { textCheckpointEvidenceSchema } from "./composition-text-parity-evidence";
import { assertRequiredFontUsageEvidence, fontUsageEvidenceSchema, validateFontUsageEvidence } from "./composition-font-usage-evidence";
import { browserIdentitySchema } from "./composition-browser-identity";
import { browserExecutableIdentitySchema } from "./composition-browser-executable-identity";
import { exportedColorTagReportSchema } from "../composition-color-tag-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { suppressedTextFrameName, verifyTextPaintMaskPair } from "./composition-text-paint-mask-derivation";
import { deckTextEvidenceSchema, validateDeckTextEvidence, type deckTextCheckpointEvidenceSchema } from "./composition-deck-text-evidence";
import { compareDeckTextRegions } from "./composition-deck-text-comparison";
import type { DeckTextPlan } from "../composition-deck-text-plan";
import { suppressedDeckTextFrameName, verifyDeckTextPaintPair } from "./composition-deck-text-paint-derivation";
import {applyRendererTextGeometry} from "./composition-renderer-text-geometry";

export const compositionConformanceCaptureMetadataSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  textParity: textParityEvidenceSchema.optional(),
  deckText: deckTextEvidenceSchema.optional(),
  fontUsage: fontUsageEvidenceSchema.optional(),
  browserIdentity: browserIdentitySchema.optional(),
  browserExecutableIdentity: browserExecutableIdentitySchema.optional(),
  colorTags: exportedColorTagReportSchema.optional(),
  frames: z.array(z.object({
    frameIndex: z.number().int().nonnegative(),
    timeSeconds: z.number().finite().nonnegative(),
  }).strict()),
}).strict();

export type CompositionConformanceCaptureMetadata = z.infer<typeof compositionConformanceCaptureMetadataSchema>;

export async function compareCompositionConformanceDirectories(params: {
  contractPath: string;
  previewDirectory: string;
  previewMetadataPath: string;
  renderDirectory: string;
  renderMetadataPath: string;
}): Promise<CompositionConformanceReport> {
  return (await measureCompositionConformanceDirectories(params)).report;
}

/** Worker measurements are retained separately from verdicts so resumed batches can be recomputed. */
export async function measureCompositionConformanceDirectories(params: {
  contractPath: string; previewDirectory: string; previewMetadataPath: string;
  renderDirectory: string; renderMetadataPath: string;
}) {
  const [contract, previewMetadata, renderMetadata] = await Promise.all([
    readJson(params.contractPath).then((value) => compositionConformanceContractSchema.parse(value)),
    readJson(params.previewMetadataPath).then((value) => compositionConformanceCaptureMetadataSchema.parse(value)),
    readJson(params.renderMetadataPath).then((value) => compositionConformanceCaptureMetadataSchema.parse(value)),
  ]);
  const previewTimes = new Map(previewMetadata.frames.map((frame) => [frame.frameIndex, frame.timeSeconds]));
  const renderTimes = new Map(renderMetadata.frames.map((frame) => [frame.frameIndex, frame.timeSeconds]));
  const samples: CompositionConformanceSample[] = [];
  validateDeckTextEvidence(previewMetadata.deckText, contract);
  assertRequiredFontUsageEvidence(previewMetadata.fontUsage, contract);
  assertRequiredTextPaintMaskEvidence(previewMetadata.textParity, contract);
  if (contract.schemaVersion === 4 && previewMetadata.textParity) validateTextParityEvidence(previewMetadata.textParity, contract);
  if (contract.schemaVersion === 4 && renderMetadata.textParity)
    validateTextParityEvidence(renderMetadata.textParity, contract, "RENDERER_GEOMETRY");
  if (previewMetadata.fontUsage) {
    if (!previewMetadata.textParity) throw new Error("CONFORMANCE_FONT_USAGE_TEXT_EVIDENCE_MISSING");
    validateTextParityEvidence(previewMetadata.textParity, contract);
    validateFontUsageEvidence(previewMetadata.fontUsage, previewMetadata.textParity);
  }

  for (const checkpoint of contract.checkpoints) {
    const fileName = `frame-${checkpoint.frameIndex}.png`;
    const previewTime = previewTimes.get(checkpoint.frameIndex);
    const renderTime = renderTimes.get(checkpoint.frameIndex);
    if (previewTime === undefined || renderTime === undefined) continue;
    samples.push(await compareFrames(
      resolve(params.previewDirectory, fileName),
      resolve(params.renderDirectory, fileName),
      checkpoint.frameIndex,
      contract.thresholds.pixelDifferenceThreshold,
      measureCompositionConformanceTemporalDriftMs({
        expectedSeconds: checkpoint.timeSeconds,
        previewSeconds: previewTime,
        renderSeconds: renderTime,
      }),
      contract.schemaVersion >= 3,
      contract.schemaVersion === 4 ? previewMetadata.textParity?.checkpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex) : undefined,
      contract.schemaVersion === 4 && contract.deckTextPlan && previewMetadata.deckText ? {
        plan: contract.deckTextPlan, checkpoint: previewMetadata.deckText.checkpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex)!,
      } : undefined,
      contract.schemaVersion === 4 && Boolean(contract.renderExecution),
      contract.schemaVersion === 4 ? renderMetadata.textParity?.checkpoints.find(entry => entry.frameIndex === checkpoint.frameIndex) : undefined,
    ));
  }

  const measurements = {
    previewDocumentHash: previewMetadata.documentHash, renderDocumentHash: renderMetadata.documentHash,
    samples, ...(renderMetadata.colorTags ? {renderColorTags: renderMetadata.colorTags} : {}),
  };
  const report = evaluateCompositionConformance({
    contract,
    previewDocumentHash: previewMetadata.documentHash,
    renderDocumentHash: renderMetadata.documentHash,
    samples,
    renderColorTags: renderMetadata.colorTags,
  });
  return {report, measurements};
}

/** Hash and decode the same bounded bytes, rather than reopening a mutable path after verification. */
async function readBoundedPaintFrame(path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  const stream = createReadStream(path);
  try {
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      length += bytes.length;
      if (length > COMPOSITION_TEXT_PARITY_POLICY.maximumPaintCapturePngBytes)
        throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
      chunks.push(bytes);
    }
    if (!length) throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
    return Buffer.concat(chunks, length);
  } finally {stream.destroy();}
}

async function compareFrames(
  previewPath: string,
  renderPath: string,
  frameIndex: number,
  pixelThreshold: number,
  temporalDriftMs: number,
  ssimRequired: boolean,
  textCheckpoint?: z.infer<typeof textCheckpointEvidenceSchema>,
  deckCheckpoint?: {plan: DeckTextPlan; checkpoint: z.infer<typeof deckTextCheckpointEvidenceSchema>},
  rendererGeometryRequired = false,
  rendererTextCheckpoint?: z.infer<typeof textCheckpointEvidenceSchema>,
): Promise<CompositionConformanceSample> {
  let previewInput: string | Buffer = previewPath;
  if (textCheckpoint?.paintMaskCapture) {
    previewInput = await readBoundedPaintFrame(previewPath);
    if (createHash("sha256").update(previewInput).digest("hex") !== textCheckpoint.paintMaskCapture.paintedPngSha256)
      throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_FRAME_MISMATCH");
    const dimensions = await sharp(previewInput, {limitInputPixels: COMPOSITION_SSIM_POLICY.maximumPixels}).metadata();
    await verifyTextPaintMaskPair({checkpoint: textCheckpoint, paintedPng: previewInput,
      suppressedPng: await readBoundedPaintFrame(resolve(dirname(previewPath), suppressedTextFrameName(frameIndex))),
      width: dimensions.width ?? 0, height: dimensions.height ?? 0});
  }
  if (deckCheckpoint?.checkpoint.paintCapture) {
    if (typeof previewInput === "string") previewInput = await readBoundedPaintFrame(previewPath);
    const dimensions = await sharp(previewInput, {limitInputPixels: COMPOSITION_SSIM_POLICY.maximumPixels}).metadata();
    await verifyDeckTextPaintPair({checkpoint: deckCheckpoint.checkpoint, paintedPng: previewInput,
      suppressedPng: await readBoundedPaintFrame(resolve(dirname(previewPath), suppressedDeckTextFrameName(frameIndex))),
      width: dimensions.width ?? 0, height: dimensions.height ?? 0});
  }
  const [preview, rendered] = await Promise.all([
    sharp(previewInput, {limitInputPixels: COMPOSITION_SSIM_POLICY.maximumPixels}).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(renderPath, {limitInputPixels: COMPOSITION_SSIM_POLICY.maximumPixels}).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (preview.info.width !== rendered.info.width
    || preview.info.height !== rendered.info.height
    || preview.info.channels !== rendered.info.channels) {
    throw new Error(`Los frames ${frameIndex} no tienen las mismas dimensiones o canales.`);
  }

  let absoluteDifference = 0;
  let squaredDifference = 0;
  let mismatchedPixels = 0;
  const channels = preview.info.channels;
  for (let offset = 0; offset < preview.data.length; offset += channels) {
    let pixelMismatch = false;
    for (let channel = 0; channel < Math.min(3, channels); channel += 1) {
      const difference = Math.abs(preview.data[offset + channel] - rendered.data[offset + channel]);
      absoluteDifference += difference;
      squaredDifference += difference ** 2;
      if (difference > pixelThreshold) pixelMismatch = true;
    }
    if (pixelMismatch) mismatchedPixels += 1;
  }
  const pixelCount = preview.info.width * preview.info.height;
  const comparedChannelCount = pixelCount * Math.min(3, channels);
  const meanSquaredError = squaredDifference / comparedChannelCount;
  const textPixels = textCheckpoint ? compareTextParityRegions({preview: preview.data, rendered: rendered.data,
    width: preview.info.width, height: preview.info.height, channels, regions: textCheckpoint.regions,
    expectedTexts: textCheckpoint.expectedTexts}) : undefined;
  const textParity = textPixels && rendererGeometryRequired
    ? applyRendererTextGeometry({pixels: textPixels, preview: textCheckpoint, rendered: rendererTextCheckpoint}) : textPixels;
  return {
    frameIndex,
    meanAbsoluteError: absoluteDifference / comparedChannelCount,
    mismatchedPixelRatio: mismatchedPixels / pixelCount,
    psnrDb: meanSquaredError === 0 ? 99 : 10 * Math.log10((255 ** 2) / meanSquaredError),
    temporalDriftMs,
    ...(deckCheckpoint ? {deckText: compareDeckTextRegions({preview: preview.data, rendered: rendered.data,
      width: preview.info.width, height: preview.info.height, channels, ...deckCheckpoint})} : {}),
    ...(textParity ? {textParity} : {}),
    ...(ssimRequired ? {ssim: measureFrameSsim(preview.data, rendered.data, preview.info.width, preview.info.height, channels),
      width: preview.info.width, height: preview.info.height} : {}),
  };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}
