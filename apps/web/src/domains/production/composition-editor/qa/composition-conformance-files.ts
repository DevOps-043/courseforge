import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
import { textParityEvidenceSchema, validateTextParityEvidence } from "./composition-text-parity-evidence";
import { compareTextParityRegions } from "./composition-text-region-comparison";
import type { textCheckpointEvidenceSchema } from "./composition-text-parity-evidence";
import { assertRequiredFontUsageEvidence, fontUsageEvidenceSchema, validateFontUsageEvidence } from "./composition-font-usage-evidence";
import { browserIdentitySchema } from "./composition-browser-identity";
import { browserExecutableIdentitySchema } from "./composition-browser-executable-identity";
import { exportedColorTagReportSchema } from "../composition-color-tag-policy";

export const compositionConformanceCaptureMetadataSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  textParity: textParityEvidenceSchema.optional(),
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
  assertRequiredFontUsageEvidence(previewMetadata.fontUsage, contract);
  if (contract.schemaVersion === 4 && previewMetadata.textParity) validateTextParityEvidence(previewMetadata.textParity, contract);
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

async function compareFrames(
  previewPath: string,
  renderPath: string,
  frameIndex: number,
  pixelThreshold: number,
  temporalDriftMs: number,
  ssimRequired: boolean,
  textCheckpoint?: z.infer<typeof textCheckpointEvidenceSchema>,
): Promise<CompositionConformanceSample> {
  const [preview, rendered] = await Promise.all([
    sharp(previewPath, {limitInputPixels: COMPOSITION_SSIM_POLICY.maximumPixels}).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
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
  return {
    frameIndex,
    meanAbsoluteError: absoluteDifference / comparedChannelCount,
    mismatchedPixelRatio: mismatchedPixels / pixelCount,
    psnrDb: meanSquaredError === 0 ? 99 : 10 * Math.log10((255 ** 2) / meanSquaredError),
    temporalDriftMs,
    ...(textCheckpoint ? {textParity: compareTextParityRegions({preview: preview.data, rendered: rendered.data,
      width: preview.info.width, height: preview.info.height, channels, regions: textCheckpoint.regions, expectedTexts: textCheckpoint.expectedTexts})} : {}),
    ...(ssimRequired ? {ssim: measureFrameSsim(preview.data, rendered.data, preview.info.width, preview.info.height, channels),
      width: preview.info.width, height: preview.info.height} : {}),
  };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}
