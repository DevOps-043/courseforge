import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import { compositionDocumentHasAudibleMedia } from "./composition-clip-audio.service";
import type { HyperframesRenderSettings } from "../hyperframes/hyperframes-render-profiles";
import { COMPOSITION_SSIM_POLICY } from "./composition-visual-metrics-policy";
import { textParityContractSchema, textRegionReportSchema } from "./composition-text-parity-contract";
import { DECK_TEXT_PLAN_POLICY, deckTextPlanSchema, deckTextNodeMetricId, selectDeckTextCheckpointClips } from "./composition-deck-text-plan";
import { DECK_TEXT_PAINT_PAIR_POLICY } from "./composition-deck-text-paint-policy";
import { COMPOSITION_TEXT_PARITY_POLICY } from "./composition-text-parity-policy";
import { declaredNativeFontUsageContractSchema, rendererFontUsagePendingSchema } from "./composition-font-usage-contract";
import { EXPORTED_COLOR_TAG_POLICY, evaluateExportedColorTags, exportedColorTagReportSchema,
  type ExportedColorTagReport } from "./composition-color-tag-policy";
import { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS, COMPOSITION_EVENT_CHECKPOINT_POLICY } from "./composition-conformance-checkpoint-policy";
import { eventCheckpointBatchSchema, eventCheckpointBatchCoverageSchema, eventBatchCheckpointCount } from "./composition-conformance-batch-contract";
import {controlledRenderExecutionContractSchema, type ControlledRenderExecutionReport} from "./composition-render-execution-contract";
import type {ControlledSeekRepeatabilityReport} from "./composition-render-seek-policy";

export const COMPOSITION_CONFORMANCE_CONTRACT_VERSION = 4;
export { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "./composition-conformance-checkpoint-policy";

export const COMPOSITION_CONFORMANCE_THRESHOLDS = {
  maxMeanAbsoluteError: 0.5,
  maxMismatchedPixelRatio: 0.001,
  maxTemporalDriftFrames: 0.5,
  minPsnrDb: 45,
  pixelDifferenceThreshold: 8,
} as const;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const compositionConformanceThresholdsSchema = z.object({
  maxMeanAbsoluteError: z.number().finite().nonnegative(),
  maxMismatchedPixelRatio: z.number().finite().min(0).max(1),
  maxTemporalDriftFrames: z.number().finite().nonnegative(),
  minPsnrDb: z.number().finite().nonnegative(),
  pixelDifferenceThreshold: z.number().int().min(0).max(255),
}).strict();

const compositionConformanceContractV1Schema = z.object({
  assets: z.array(z.object({ checksum: hashSchema, id: z.string().min(1) }).strict()),
  canvas: z.object({
    durationSeconds: z.number().finite().positive(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  }).strict(),
  checkpoints: z.array(z.object({
    frameIndex: z.number().int().nonnegative(),
    reasons: z.array(z.string().min(1)).min(1),
    timeSeconds: z.number().finite().nonnegative(),
  }).strict()).min(1).max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
  compilerContract: z.literal("courseforge-composition-preview-compiler-v1"),
  documentHash: hashSchema,
  renderProfile: z.object({
    format: z.literal("mp4"),
    fps: z.number().int().positive(),
    quality: z.string().min(1),
    resolution: z.literal("1080p"),
  }).passthrough(),
  schemaVersion: z.literal(1),
  thresholds: compositionConformanceThresholdsSchema,
}).strict();

const compositionConformanceContractV2Schema = compositionConformanceContractV1Schema.extend({
  audio: z.object({ required: z.boolean() }).strict(),
  schemaVersion: z.literal(2),
}).strict();

const compositionConformanceContractV3Schema = compositionConformanceContractV2Schema.extend({
  schemaVersion: z.literal(3),
  visualMetrics: z.object({ssimPolicy: z.literal(COMPOSITION_SSIM_POLICY.id), minimumSsim: z.literal(COMPOSITION_SSIM_POLICY.minimum)}).strict(),
}).strict();

const compositionConformanceContractV4Schema = compositionConformanceContractV3Schema.extend({
  schemaVersion: z.literal(COMPOSITION_CONFORMANCE_CONTRACT_VERSION), textParity: textParityContractSchema,
  fontUsageContract: declaredNativeFontUsageContractSchema.optional(),
  deckTextPlan: deckTextPlanSchema.optional(),
  deckTextPaintMaskPolicy: z.literal(DECK_TEXT_PAINT_PAIR_POLICY).optional(),
  colorTagPolicy: z.literal(EXPORTED_COLOR_TAG_POLICY).optional(),
  checkpointPolicy: z.literal(COMPOSITION_EVENT_CHECKPOINT_POLICY).optional(),
  checkpointBatch: eventCheckpointBatchSchema.optional(),
  renderExecution: controlledRenderExecutionContractSchema.optional(),
}).strict();

export const compositionConformanceContractSchema = z.discriminatedUnion("schemaVersion", [
  compositionConformanceContractV1Schema,
  compositionConformanceContractV2Schema,
  compositionConformanceContractV3Schema,
  compositionConformanceContractV4Schema,
]).superRefine((contract, context) => {
  if (contract.schemaVersion === 4 && contract.renderExecution?.sdrConversionPolicy && !contract.colorTagPolicy)
    context.addIssue({code: "custom", message: "CONFORMANCE_SDR_COLOR_TAG_POLICY_REQUIRED"});
  if (contract.schemaVersion === 4 && contract.deckTextPaintMaskPolicy && !contract.deckTextPlan)
    context.addIssue({code: "custom", message: "CONFORMANCE_DECK_PAINT_PLAN_REQUIRED"});
  if (contract.schemaVersion === 4 && contract.deckTextPlan && contract.deckTextPlan.documentHash !== contract.documentHash)
    context.addIssue({code: "custom", message: "CONFORMANCE_DECK_TEXT_DOCUMENT_MISMATCH"});
  if (contract.schemaVersion === 4 && contract.checkpointBatch
    && (!contract.checkpointPolicy || contract.checkpoints.length !== eventBatchCheckpointCount(contract.checkpointBatch))) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_BATCH_CONTRACT_INVALID"});
  }
  if (contract.schemaVersion === 4 && (contract.textParity.checkpoints.length !== contract.checkpoints.length
    || contract.checkpoints.some((checkpoint) => !contract.textParity.checkpoints.some((entry) => entry.frameIndex === checkpoint.frameIndex
      && entry.timeSeconds === checkpoint.timeSeconds)))) context.addIssue({code: "custom", message: "CONFORMANCE_TEXT_CONTRACT_COVERAGE_INVALID"});
});

export type CompositionConformanceContract = z.infer<typeof compositionConformanceContractSchema>;

export type CompositionConformanceSample = {
  frameIndex: number;
  meanAbsoluteError: number;
  mismatchedPixelRatio: number;
  psnrDb: number;
  temporalDriftMs: number;
  ssim?: number;
  width?: number;
  height?: number;
  textParity?: z.infer<typeof textRegionReportSchema>;
  deckText?: z.infer<typeof textRegionReportSchema>;
};

export const compositionConformanceSampleSchema = z.object({
  frameIndex: z.number().int().nonnegative(),
  meanAbsoluteError: z.number().finite().nonnegative(),
  mismatchedPixelRatio: z.number().finite().min(0).max(1),
  psnrDb: z.number().finite().nonnegative(),
  temporalDriftMs: z.number().finite().nonnegative(),
  ssim: z.number().finite().min(-1).max(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  textParity: textRegionReportSchema.optional(),
  deckText: textRegionReportSchema.optional(),
}).strict();

/** Detects shared seek errors as well as preview-versus-render drift. */
export function measureCompositionConformanceTemporalDriftMs(params: {
  expectedSeconds: number;
  previewSeconds: number;
  renderSeconds: number;
}): number {
  return Math.max(
    Math.abs(params.previewSeconds - params.expectedSeconds),
    Math.abs(params.renderSeconds - params.expectedSeconds),
    Math.abs(params.previewSeconds - params.renderSeconds),
  ) * 1_000;
}

export type CompositionConformanceReport = {
  thresholds?: z.infer<typeof compositionConformanceThresholdsSchema>;
  incompletenessReasons?: import("./composition-conformance-incompleteness").CompositionConformanceIncompleteReason[];
  checkedCheckpointCount: number;
  failures: Array<{ frameIndex?: number; message: string; metric: string }>;
  observed: {
    maxMeanAbsoluteError: number | null;
    maxMismatchedPixelRatio: number | null;
    maxTemporalDriftFrames: number | null;
    minPsnrDb: number | null;
  };
  requiredCheckpointCount: number;
  fontUsage?: z.infer<typeof rendererFontUsagePendingSchema>;
  colorTags?: ExportedColorTagReport;
  renderExecution?: ControlledRenderExecutionReport;
  seekRepeatability?: ControlledSeekRepeatabilityReport;
  checkpointBatchCoverage?: z.infer<typeof eventCheckpointBatchCoverageSchema>;
  ssim?: {policy: typeof COMPOSITION_SSIM_POLICY.id; minimumRequired: number; minimumObserved: number | null; checkedCheckpointCount: number};
  textParity?: {policy: typeof COMPOSITION_TEXT_PARITY_POLICY.id; scope: "NATIVE_TEXT_AND_CAPTIONS"; status: "PASS" | "FAIL" | "INCOMPLETE";
    checkedCheckpointCount: number; requiredCheckpointCount: number; expectedRegionCount: number; checkedRegionCount: number};
  deckText?: {policy: typeof DECK_TEXT_PLAN_POLICY; scope: "DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION";
    status: "PASS" | "FAIL" | "INCOMPLETE"; checkedCheckpointCount: number; requiredCheckpointCount: number;
    expectedRegionCount: number; checkedRegionCount: number};
  status: "FAIL" | "INCOMPLETE" | "PASS";
};

export function buildCompositionConformanceContract(params: {
  assets: Array<{ checksum: string; id: string }>;
  contractVersion?: 1 | 2 | 3;
  document: CompositionEditorDocument;
  documentHash: string;
  renderProfile: HyperframesRenderSettings;
}): CompositionConformanceContract {
  const contract = {
    assets: [...params.assets]
      .map((asset) => ({ checksum: asset.checksum.toLowerCase(), id: asset.id }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    canvas: {
      durationSeconds: params.document.canvas.durationSeconds,
      fps: params.document.canvas.fps,
      height: params.document.canvas.height,
      width: params.document.canvas.width,
    },
    checkpoints: buildCompositionConformanceCheckpoints(params.document),
    compilerContract: "courseforge-composition-preview-compiler-v1" as const,
    documentHash: params.documentHash.toLowerCase(),
    renderProfile: params.renderProfile,
    thresholds: { ...COMPOSITION_CONFORMANCE_THRESHOLDS },
  };
  if (params.contractVersion === 1) {
    return compositionConformanceContractV1Schema.parse({ ...contract, schemaVersion: 1 });
  }
  if (params.contractVersion === 3) {
    return compositionConformanceContractV3Schema.parse({...contract, audio: {required: compositionDocumentHasAudibleMedia(params.document)},
      schemaVersion: 3, visualMetrics: {ssimPolicy: COMPOSITION_SSIM_POLICY.id, minimumSsim: COMPOSITION_SSIM_POLICY.minimum}});
  }
  return compositionConformanceContractV2Schema.parse({
    ...contract,
    audio: { required: compositionDocumentHasAudibleMedia(params.document) },
    schemaVersion: 2,
  });
}

/** Default remains v1 until every snapshot reader can parse v2. */
export function resolveSnapshotConformanceContractVersion(rawFlag: string | undefined, visualFlag?: string, textFlag?: string): 1 | 2 | 3 | 4 {
  if (textFlag === "true") return 4;
  if (visualFlag === "true") return 3;
  return rawFlag === "true" ? 2 : 1;
}

export function evaluateCompositionConformance(params: {
  contract: CompositionConformanceContract;
  previewDocumentHash: string;
  renderDocumentHash: string;
  samples: CompositionConformanceSample[];
  renderColorTags?: ExportedColorTagReport;
}): CompositionConformanceReport {
  const contract = compositionConformanceContractSchema.parse(params.contract);
  const requiredColorPolicy = contract.schemaVersion === 4 ? contract.colorTagPolicy : undefined;
  const providedColorTags = params.renderColorTags ? exportedColorTagReportSchema.parse(params.renderColorTags) : undefined;
  const colorTags = requiredColorPolicy
    ? evaluateExportedColorTags(providedColorTags?.tags ?? {matrix: null, primaries: null, transfer: null, range: null}, requiredColorPolicy)
    : providedColorTags;
  const failures: CompositionConformanceReport["failures"] = [];
  if (params.previewDocumentHash !== contract.documentHash) {
    failures.push({ message: "El preview no corresponde al documento congelado.", metric: "preview_document_hash" });
  }
  if (params.renderDocumentHash !== contract.documentHash) {
    failures.push({ message: "El render no corresponde al documento congelado.", metric: "render_document_hash" });
  }

  const samplesByFrame = new Map<number, CompositionConformanceSample>();
  for (const candidate of params.samples) {
    const parsed = compositionConformanceSampleSchema.safeParse(candidate);
    if (!parsed.success) {
      failures.push({ frameIndex: candidate.frameIndex, message: "La medición del checkpoint es inválida.", metric: "invalid_sample" });
      continue;
    }
    if (samplesByFrame.has(parsed.data.frameIndex)) {
      failures.push({ frameIndex: parsed.data.frameIndex, message: "El checkpoint tiene mediciones duplicadas.", metric: "duplicate_sample" });
      continue;
    }
    samplesByFrame.set(parsed.data.frameIndex, parsed.data);
  }
  let checkedCheckpointCount = 0;
  let checkedSsimCount = 0;
  let minimumSsim: number | null = null;
  const textSummary: NonNullable<CompositionConformanceReport["textParity"]> = {policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS", status: "PASS",
    checkedCheckpointCount: 0, requiredCheckpointCount: contract.checkpoints.length,
    expectedRegionCount: contract.schemaVersion === 4 ? contract.textParity.checkpoints.reduce((count, checkpoint) => count + checkpoint.expectedTexts.length, 0) : 0,
    checkedRegionCount: 0};
  const deckSummary: CompositionConformanceReport["deckText"] = contract.schemaVersion === 4 && contract.deckTextPlan
    ? {policy: DECK_TEXT_PLAN_POLICY, scope: "DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION", status: "PASS",
      checkedCheckpointCount: 0, requiredCheckpointCount: contract.checkpoints.length,
      expectedRegionCount: contract.checkpoints.reduce((count, checkpoint) => count + selectDeckTextCheckpointClips(contract.deckTextPlan!, checkpoint.timeSeconds)
        .reduce((clipCount, clip) => clipCount + clip.entries.length, 0), 0), checkedRegionCount: 0} : undefined;
  const observed: CompositionConformanceReport["observed"] = {
    maxMeanAbsoluteError: null,
    maxMismatchedPixelRatio: null,
    maxTemporalDriftFrames: null,
    minPsnrDb: null,
  };
  for (const checkpoint of contract.checkpoints) {
    const sample = samplesByFrame.get(checkpoint.frameIndex);
    if (!sample) continue;
    checkedCheckpointCount += 1;
    if (sample.deckText && !deckSummary) throw new Error("CONFORMANCE_DECK_TEXT_METRICS_UNAUTHORIZED");
    if (deckSummary && contract.schemaVersion === 4 && contract.deckTextPlan) {
      if (!sample.deckText) {if (deckSummary.status !== "FAIL") deckSummary.status = "INCOMPLETE";}
      else {
        const measured = textRegionReportSchema.parse(sample.deckText);
        deckSummary.checkedCheckpointCount++; deckSummary.checkedRegionCount += measured.checkedRegionCount;
        const expectedIds = new Set(selectDeckTextCheckpointClips(contract.deckTextPlan, checkpoint.timeSeconds).flatMap((clip) =>
          clip.entries.map((entry) => deckTextNodeMetricId({clipId: clip.clipId, nodePath: entry.nodePath}))));
        if (measured.expectedRegionCount !== expectedIds.size || measured.regions.length !== expectedIds.size
          || measured.regions.some((region) => !expectedIds.has(region.elementId)) || measured.status === "FAIL") {
          deckSummary.status = "FAIL";
          failures.push({frameIndex: checkpoint.frameIndex, metric: "deck_text_parity", message: "Texto de deck fuera de tolerancia o cobertura distinta al contrato."});
        } else if (measured.status !== "PASS" && deckSummary.status !== "FAIL") deckSummary.status = "INCOMPLETE";
      }
    }
    if (contract.schemaVersion >= 3 && "visualMetrics" in contract) {
      if (sample.width !== undefined && sample.height !== undefined
        && (sample.width !== contract.canvas.width || sample.height !== contract.canvas.height)) {
        failures.push({frameIndex: checkpoint.frameIndex, message: "La resolución no corresponde al canvas congelado.", metric: "frame_dimensions"});
      }
      if (sample.ssim !== undefined && sample.width !== undefined && sample.height !== undefined) {
        checkedSsimCount++;
        minimumSsim = Math.min(minimumSsim ?? sample.ssim, sample.ssim);
        if (sample.ssim < contract.visualMetrics.minimumSsim) {
          failures.push({frameIndex: checkpoint.frameIndex, message: `SSIM ${sample.ssim.toFixed(6)}.`, metric: "ssim"});
        }
      }
    }
    if (contract.schemaVersion === 4) {
      const expectation = contract.textParity.checkpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex);
      if (!expectation || expectation.timeSeconds !== checkpoint.timeSeconds) throw new Error("CONFORMANCE_TEXT_CONTRACT_COVERAGE_INVALID");
      const text = sample.textParity;
      if (!text) {if (textSummary.status !== "FAIL") textSummary.status = "INCOMPLETE";}
      else {
        textSummary.checkedCheckpointCount++; textSummary.checkedRegionCount += text.checkedRegionCount;
        const expectedIds = new Set(expectation.expectedTexts.map((entry) => entry.elementId));
        if (text.expectedRegionCount !== expectedIds.size || text.regions.length !== expectedIds.size
          || new Set(text.regions.map((region) => region.elementId)).size !== expectedIds.size
          || text.regions.some((region) => !expectedIds.has(region.elementId)) || text.status === "FAIL") {
          textSummary.status = "FAIL"; failures.push({frameIndex: checkpoint.frameIndex, metric: "text_parity", message: "Texto/caption fuera de tolerancia o cobertura distinta al contrato."});
        } else if (text.status !== "PASS" && textSummary.status !== "FAIL") textSummary.status = "INCOMPLETE";
      }
    }
    const driftFrames = Math.abs(sample.temporalDriftMs) * contract.canvas.fps / 1_000;
    observed.maxMeanAbsoluteError = Math.max(observed.maxMeanAbsoluteError ?? 0, sample.meanAbsoluteError);
    observed.maxMismatchedPixelRatio = Math.max(observed.maxMismatchedPixelRatio ?? 0, sample.mismatchedPixelRatio);
    observed.maxTemporalDriftFrames = Math.max(observed.maxTemporalDriftFrames ?? 0, driftFrames);
    observed.minPsnrDb = Math.min(observed.minPsnrDb ?? sample.psnrDb, sample.psnrDb);
    if (sample.mismatchedPixelRatio > contract.thresholds.maxMismatchedPixelRatio) {
      failures.push({ frameIndex: checkpoint.frameIndex, message: `Diferencia de píxeles ${(sample.mismatchedPixelRatio * 100).toFixed(3)}%.`, metric: "mismatched_pixel_ratio" });
    }
    if (sample.meanAbsoluteError > contract.thresholds.maxMeanAbsoluteError) {
      failures.push({ frameIndex: checkpoint.frameIndex, message: `Error absoluto medio ${sample.meanAbsoluteError.toFixed(3)}.`, metric: "mean_absolute_error" });
    }
    if (sample.psnrDb < contract.thresholds.minPsnrDb) {
      failures.push({ frameIndex: checkpoint.frameIndex, message: `PSNR ${sample.psnrDb.toFixed(2)} dB.`, metric: "psnr_db" });
    }
    if (driftFrames > contract.thresholds.maxTemporalDriftFrames) {
      failures.push({ frameIndex: checkpoint.frameIndex, message: `Deriva temporal ${driftFrames.toFixed(3)} frames.`, metric: "temporal_drift_frames" });
    }
  }

  const fontUsage = contract.schemaVersion === 4 && (contract.fontUsageContract?.bindings.length ?? 0) > 0
    ? rendererFontUsagePendingSchema.parse({policy: contract.fontUsageContract!.policy, scope: "RENDERER_GLYPH_PROVENANCE",
      status: "INCOMPLETE", reason: "RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE",
      manifestSha256: contract.fontUsageContract!.manifestSha256, requiredBindingCount: contract.fontUsageContract!.bindings.length}) : undefined;
  const deckTextPending = contract.schemaVersion === 4 && Boolean(contract.deckTextPlan?.clips.length);
  const complete = checkedCheckpointCount === contract.checkpoints.length
    && (contract.schemaVersion < 3 || checkedSsimCount === contract.checkpoints.length)
    && (contract.schemaVersion !== 4 || (textSummary.checkedCheckpointCount === contract.checkpoints.length && textSummary.status === "PASS"))
    && (!deckSummary || (deckSummary.checkedCheckpointCount === contract.checkpoints.length && deckSummary.status === "PASS"
      && deckSummary.checkedRegionCount === deckSummary.expectedRegionCount))
    // Preview font evidence cannot certify the renderer's glyph/font choices.
    && fontUsage === undefined && colorTags?.status !== "INCOMPLETE" && !requiredColorPolicy && !deckTextPending
    && !(contract.schemaVersion === 4 && contract.renderExecution);
  if (colorTags?.status === "FAIL") failures.push({metric: "encoded_color_tags", message: "Las etiquetas de color no cumplen la política seleccionada."});
  const localStatus = contract.schemaVersion >= 3 && failures.length > 0 ? "FAIL"
    : !complete ? "INCOMPLETE" : failures.length > 0 ? "FAIL" : "PASS";
  const checkpointBatch = contract.schemaVersion === 4 ? contract.checkpointBatch : undefined;
  const incompletenessReasons: NonNullable<CompositionConformanceReport["incompletenessReasons"]> = [];
  if (checkedCheckpointCount !== contract.checkpoints.length) incompletenessReasons.push("CHECKPOINT_SAMPLES_MISSING");
  if (contract.schemaVersion >= 3 && checkedSsimCount !== contract.checkpoints.length) incompletenessReasons.push("SSIM_CHECKPOINTS_MISSING");
  if (contract.schemaVersion === 4 && (textSummary.checkedCheckpointCount !== contract.checkpoints.length
    || textSummary.status !== "PASS")) incompletenessReasons.push("NATIVE_TEXT_EVIDENCE_INCOMPLETE");
  if (fontUsage) incompletenessReasons.push("RENDERER_FONT_USAGE_UNAVAILABLE");
  if (deckTextPending || deckSummary && (deckSummary.status !== "PASS"
    || deckSummary.checkedCheckpointCount !== contract.checkpoints.length
    || deckSummary.checkedRegionCount !== deckSummary.expectedRegionCount))
    incompletenessReasons.push("DECK_TEXT_EVIDENCE_INCOMPLETE");
  if (colorTags?.status === "INCOMPLETE") incompletenessReasons.push("COLOR_TAGS_INCOMPLETE");
  if (requiredColorPolicy) incompletenessReasons.push("SDR_PIXEL_CONVERSION_UNATTESTED");
  if (contract.schemaVersion === 4 && contract.renderExecution) incompletenessReasons.push("RENDER_EXECUTION_ATTESTATION_PENDING");
  if (contract.schemaVersion === 4 && contract.renderExecution?.seekRepeatabilityPolicy)
    incompletenessReasons.push("RENDER_SEEK_REPEATABILITY_UNAVAILABLE");
  if (checkpointBatch && checkpointBatch.batchCount > 1) incompletenessReasons.push("EVENT_PARTITION_COVERAGE");
  return {
    thresholds: {...contract.thresholds},
    incompletenessReasons,
    checkedCheckpointCount,
    failures,
    observed,
    requiredCheckpointCount: contract.checkpoints.length,
    ...(fontUsage ? {fontUsage} : {}),
    ...(colorTags ? {colorTags} : {}),
    ...(checkpointBatch ? {checkpointBatchCoverage: eventCheckpointBatchCoverageSchema.parse({
      scope: "ONE_EVENT_PARTITION_NOT_GLOBAL_COVERAGE", batch: checkpointBatch, measuredCheckpointCount: checkedCheckpointCount, localStatus})} : {}),
    ...(contract.schemaVersion >= 3 && "visualMetrics" in contract ? {ssim: {policy: COMPOSITION_SSIM_POLICY.id, minimumRequired: contract.visualMetrics.minimumSsim,
      minimumObserved: minimumSsim, checkedCheckpointCount: checkedSsimCount}} : {}),
    ...(contract.schemaVersion === 4 ? {textParity: {...textSummary, status: textSummary.checkedCheckpointCount < contract.checkpoints.length
      && textSummary.status !== "FAIL" ? "INCOMPLETE" as const : textSummary.status}} : {}),
    ...(deckSummary ? {deckText: {...deckSummary, status: deckSummary.checkedCheckpointCount < contract.checkpoints.length
      && deckSummary.status !== "FAIL" ? "INCOMPLETE" as const : deckSummary.status}} : {}),
    status: checkpointBatch && checkpointBatch.batchCount > 1 && localStatus === "PASS" ? "INCOMPLETE" : localStatus,
  };
}

export function summarizeCompositionConformanceContract(contract: CompositionConformanceContract) {
  return {
    ...(contract.schemaVersion === 4 && contract.checkpointBatch ? {
      checkpointBatch: contract.checkpointBatch,
      checkpointScope: contract.checkpointBatch.batchCount > 1 ? "ONE_NATIVE_EVENT_PARTITION" as const : "ALL_NATIVE_EVENT_CHECKPOINTS" as const,
    } : {}),
    checkpointCount: contract.checkpoints.length,
    documentHash: contract.documentHash,
    maxMismatchedPixelRatio: contract.thresholds.maxMismatchedPixelRatio,
    maxTemporalDriftFrames: contract.thresholds.maxTemporalDriftFrames,
    schemaVersion: contract.schemaVersion,
  };
}

function buildCompositionConformanceCheckpoints(document: CompositionEditorDocument) {
  const fps = document.canvas.fps;
  const lastFrameIndex = Math.max(0, Math.ceil(document.canvas.durationSeconds * fps) - 1);
  const candidates = new Map<number, Set<string>>();
  const add = (timeSeconds: number, reason: string) => {
    const frameIndex = Math.max(0, Math.min(lastFrameIndex, Math.round(timeSeconds * fps)));
    const reasons = candidates.get(frameIndex) || new Set<string>();
    reasons.add(reason);
    candidates.set(frameIndex, reasons);
  };

  add(0, "composition-start");
  add(lastFrameIndex / fps, "composition-end");
  for (let index = 1; index < 12; index += 1) {
    add(document.canvas.durationSeconds * index / 12, "uniform-sample");
  }
  for (const clip of document.clips) {
    add(clip.startSeconds, `clip-start:${clip.id}`);
    add(Math.max(0, clip.startSeconds - 1 / fps), `before-clip-start:${clip.id}`);
    add(clip.startSeconds + clip.durationSeconds, `clip-end:${clip.id}`);
    add(Math.max(0, clip.startSeconds + clip.durationSeconds - 1 / fps), `before-clip-end:${clip.id}`);
    if (clip.freezeTailSeconds !== undefined) {
      const sourceEndSeconds = clip.startSeconds + clip.durationSeconds - clip.freezeTailSeconds;
      add(Math.max(0, sourceEndSeconds - 1 / fps), `freeze-before-source-end:${clip.id}`);
      add(sourceEndSeconds, `freeze-source-end:${clip.id}`);
      add(sourceEndSeconds + clip.freezeTailSeconds / 2, `freeze-tail-midpoint:${clip.id}`);
      add(clip.startSeconds + clip.durationSeconds - 1 / fps, `freeze-tail-last-frame:${clip.id}`);
    }
  }

  const sorted = [...candidates.entries()].sort(([left], [right]) => left - right);
  const retained = sorted.length <= COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS
    ? sorted
    : sampleCheckpointCandidates(sorted, COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS);
  return retained.map(([frameIndex, reasons]) => ({
    frameIndex,
    reasons: [...reasons].sort(),
    timeSeconds: Number((frameIndex / fps).toFixed(6)),
  }));
}

function sampleCheckpointCandidates(
  candidates: Array<[number, Set<string>]>,
  maximum: number,
) {
  const boundaryFrames = new Set([candidates[0]?.[0], candidates.at(-1)?.[0]]);
  const priorityCandidates = candidates.filter(([frameIndex, reasons]) => (
    boundaryFrames.has(frameIndex) || [...reasons].some((reason) => reason.startsWith("freeze-"))
  ));
  const priority = sampleEvenly(priorityCandidates, Math.min(priorityCandidates.length, maximum));
  const priorityFrames = new Set(priority.map(([frameIndex]) => frameIndex));
  const remaining = candidates.filter(([frameIndex]) => !priorityFrames.has(frameIndex));
  return [...priority, ...sampleEvenly(remaining, maximum - priority.length)]
    .sort(([left], [right]) => left - right);
}

function sampleEvenly(candidates: Array<[number, Set<string>]>, maximum: number) {
  if (maximum <= 0) return [];
  if (candidates.length <= maximum) return candidates;
  if (maximum === 1) return [candidates[Math.floor((candidates.length - 1) / 2)]!];
  return Array.from({ length: maximum }, (_, index) => (
    candidates[Math.round(index * (candidates.length - 1) / (maximum - 1))]!
  ));
}
