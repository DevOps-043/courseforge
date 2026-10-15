import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompositionEditorDocument } from "../composition-document.types";
import { prepareCompositionEventBatchContracts } from "../composition-conformance-event-batch-contract";
import { eventCheckpointBatchSchema, COMPOSITION_EVENT_PLAN_MAX_BATCHES, COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS } from "../composition-conformance-batch-contract";
import { compositionConformanceSampleSchema, evaluateCompositionConformance,
  type CompositionConformanceContract } from "../composition-preview-render-conformance";
import { exportedColorTagReportSchema } from "../composition-color-tag-policy";
import { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "../composition-conformance-checkpoint-policy";
import { aggregateEventVisualMetrics, eventVisualMetricsFromReport, eventVisualMetricsSchema, type EventVisualMetrics } from "./composition-event-visual-metrics";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { buildEventBatchDiagnostic, eventExecutionDiagnosticsSchema, EVENT_DIAGNOSTIC_MAX_BATCHES, type EventBatchDiagnostic } from "./composition-event-diagnostics";
import { prepareEventDiagnosticLocations } from "./composition-event-diagnostic-location";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const eventBatchMeasurementIdentitySchema = z.object({
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), projectHash: hashSchema, videoSha256: hashSchema,
  documentHash: hashSchema, parentContractSha256: hashSchema, batchContractSha256: hashSchema,
  batch: eventCheckpointBatchSchema,
  visualReferenceSha256: hashSchema.optional(),
}).strict();
export type EventBatchMeasurementIdentity = z.infer<typeof eventBatchMeasurementIdentitySchema>;
export const eventBatchMeasurementPacketSchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal("EVENT_VISUAL_SAMPLE_PACKET_NOT_INDEPENDENT_ATTESTATION"),
  identity: eventBatchMeasurementIdentitySchema,
  previewDocumentHash: hashSchema, renderDocumentHash: hashSchema,
  samples: z.array(compositionConformanceSampleSchema).max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
  renderColorTags: exportedColorTagReportSchema.optional(),
}).strict();
export type EventBatchMeasurementPacket = z.infer<typeof eventBatchMeasurementPacketSchema>;
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const persistedEventBatchMeasurementSchema = z.object({packetSha256: hashSchema, packet: eventBatchMeasurementPacketSchema}).strict();
export function hashEventBatchMeasurementPacket(packet: unknown): string {
  return sha256(eventBatchMeasurementPacketSchema.parse(packet));
}

export const eventBatchExecutionSummarySchema = z.object({
  schemaVersion: z.literal(1), scope: z.literal("COMPLETE_NATIVE_EVENT_VISUAL_SAMPLE_COVERAGE_NOT_FULL_RENDER_ATTESTATION"),
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), projectHash: hashSchema, videoSha256: hashSchema,
  documentHash: hashSchema, parentContractSha256: hashSchema, planSha256: hashSchema,
  visualMetrics: eventVisualMetricsSchema.optional(),
  diagnostics: eventExecutionDiagnosticsSchema.optional(),
  status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), requiredBatchCount: z.number().int().positive().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
  measuredBatchCount: z.number().int().positive().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES), resumedBatchCount: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
  requiredCheckpointCount: z.number().int().positive().max(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS), measuredCheckpointCount: z.number().int().nonnegative().max(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS),
  batches: z.array(z.object({batchIndex: z.number().int().nonnegative(), packetSha256: hashSchema,
    visualReferenceSha256: hashSchema.optional(),
    status: z.enum(["PASS", "FAIL", "INCOMPLETE"]), measuredCheckpointCount: z.number().int().nonnegative().max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
    visualMetrics: eventVisualMetricsSchema.optional()}).strict()).min(1).max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
}).strict().superRefine((summary, context) => {
  const expectedBatchCount = Math.ceil(summary.requiredCheckpointCount / COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS);
  const invalidBatches = summary.batches.some((batch, index) => batch.batchIndex !== index
    || batch.measuredCheckpointCount > Math.min(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS,
      summary.requiredCheckpointCount - index * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS)
    || batch.status === "PASS" && batch.measuredCheckpointCount !== Math.min(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS,
      summary.requiredCheckpointCount - index * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS));
  const measured = summary.batches.reduce((count, batch) => count + batch.measuredCheckpointCount, 0);
  if (summary.diagnostics) {
    const affected = summary.batches.filter((batch) => batch.status !== "PASS");
    if (summary.diagnostics.affectedBatchCount !== affected.length
      || summary.diagnostics.batches.some((diagnostic, index) => {
        const batch = affected[index];
        return !batch || diagnostic.batchIndex !== batch.batchIndex || diagnostic.packetSha256 !== batch.packetSha256
          || diagnostic.location && diagnostic.location.documentHash !== summary.documentHash
          || batch.status === "FAIL" && diagnostic.failureCount === 0
          || batch.status === "INCOMPLETE" && (diagnostic.failureCount > 0 || diagnostic.incompleteReasons.length === 0);
      })) context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_DIAGNOSTIC_BINDING_INVALID"});
  }
  const withMetrics = summary.batches.filter((batch) => batch.visualMetrics !== undefined);
  if (summary.visualMetrics || withMetrics.length) {
    const invalidMetrics = !summary.visualMetrics || withMetrics.length !== summary.batches.length
      || summary.batches.some((batch, index) => {
        const metrics = batch.visualMetrics!;
        return metrics.checkedCheckpointCount !== batch.measuredCheckpointCount
          || metrics.requiredCheckpointCount !== Math.min(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS,
            summary.requiredCheckpointCount - index * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS)
          || metrics.textParity.expectedRegionCount > COMPOSITION_TEXT_PARITY_POLICY.maximumRegionsPerCapture
          || metrics.textParity.checkedRegionCount > COMPOSITION_TEXT_PARITY_POLICY.maximumRegions * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS
          || metrics.ssim.minimumRequired !== withMetrics[0]!.visualMetrics!.ssim.minimumRequired
          || JSON.stringify(metrics.thresholds) !== JSON.stringify(withMetrics[0]!.visualMetrics!.thresholds)
          || Boolean(metrics.deckText) !== Boolean(withMetrics[0]!.visualMetrics!.deckText)
          || batch.status === "PASS" && (metrics.textParity.status !== "PASS"
            || metrics.deckText && metrics.deckText.status !== "PASS"
            || metrics.ssim.checkedCheckpointCount !== metrics.requiredCheckpointCount
            || metrics.ssim.minimumObserved === null || metrics.ssim.minimumObserved < metrics.ssim.minimumRequired
            || metrics.observed.maxMeanAbsoluteError === null || metrics.observed.maxMeanAbsoluteError > metrics.thresholds.maxMeanAbsoluteError
            || metrics.observed.maxMismatchedPixelRatio === null || metrics.observed.maxMismatchedPixelRatio > metrics.thresholds.maxMismatchedPixelRatio
            || metrics.observed.maxTemporalDriftFrames === null || metrics.observed.maxTemporalDriftFrames > metrics.thresholds.maxTemporalDriftFrames
            || metrics.observed.minPsnrDb === null || metrics.observed.minPsnrDb < metrics.thresholds.minPsnrDb);
      });
    if (invalidMetrics || JSON.stringify(summary.visualMetrics) !== JSON.stringify(aggregateEventVisualMetrics(withMetrics.map((batch) => batch.visualMetrics!)))) {
      context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_SUMMARY_METRICS_MISMATCH"});
    }
  }
  const expectedStatus = summary.batches.some((batch) => batch.status === "FAIL") ? "FAIL"
    : summary.batches.length !== summary.requiredBatchCount || measured !== summary.requiredCheckpointCount
      || summary.batches.some((batch) => batch.status !== "PASS") ? "INCOMPLETE" : "PASS";
  if (invalidBatches || summary.requiredBatchCount !== expectedBatchCount || summary.measuredBatchCount !== summary.batches.length
    || summary.measuredBatchCount > summary.requiredBatchCount || summary.resumedBatchCount > summary.measuredBatchCount
    || summary.measuredCheckpointCount !== measured || summary.status !== expectedStatus) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_SUMMARY_COVERAGE_INVALID"});
  }
});

export type EventBatchMeasurementAdapters = {
  /** Read exact private scoped record plus its persisted checksum; verify Storage/auth in the adapter. */
  readBatch(identity: EventBatchMeasurementIdentity): Promise<unknown | null>;
  measureBatch(input: {identity: EventBatchMeasurementIdentity; contract: CompositionConformanceContract}): Promise<unknown>;
  persistBatch(packet: EventBatchMeasurementPacket): Promise<void>;
};

/** Sequential worker coordinator. It recomputes persisted measurements; stored PASS is never trusted. */
export async function executeCompositionEventCheckpointBatches(input: {
  document: CompositionEditorDocument; parentContract: CompositionConformanceContract;
  organizationId: string; revisionId: string; projectHash: string; videoSha256: string;
  signal?: AbortSignal;
  visualReferenceChecksums?: string[];
}, adapters: EventBatchMeasurementAdapters) {
  const signal = input.signal;
  const assertActive = () => {if (signal?.aborted) throw new Error("CONFORMANCE_EVENT_EXECUTION_ABORTED");};
  assertActive();
  const executionScope = z.object({organizationId: z.string().uuid(), revisionId: z.string().uuid(),
    projectHash: hashSchema, videoSha256: hashSchema}).strict().parse({organizationId: input.organizationId,
    revisionId: input.revisionId, projectHash: input.projectHash, videoSha256: input.videoSha256});
  const prepared = prepareCompositionEventBatchContracts(input);
  const visualReferences = input.visualReferenceChecksums === undefined ? undefined
    : z.array(hashSchema).length(prepared.batchCount).parse(input.visualReferenceChecksums);
  const locateDiagnostic = prepareEventDiagnosticLocations(input.document);
  const {parentContractSha256, planSha256, documentHash} = prepared;
  let measuredCheckpointCount = 0, resumedBatchCount = 0;
  let affectedBatchCount = 0;
  const diagnostics: EventBatchDiagnostic[] = [];
  const batches: Array<{batchIndex: number; packetSha256: string; visualReferenceSha256?: string; status: "PASS" | "FAIL" | "INCOMPLETE"; measuredCheckpointCount: number; visualMetrics: EventVisualMetrics}> = [];
  for (let batchIndex = 0; batchIndex < prepared.batchCount; batchIndex++) {
    assertActive();
    const {contract, batchContractSha256} = prepared.select(batchIndex);
    const identity = eventBatchMeasurementIdentitySchema.parse({...executionScope, documentHash, parentContractSha256,
      batchContractSha256, batch: contract.schemaVersion === 4 ? contract.checkpointBatch : undefined,
      ...(visualReferences ? {visualReferenceSha256: visualReferences[batchIndex]} : {})});
    const validate = (raw: unknown) => {
      const packet = eventBatchMeasurementPacketSchema.parse(raw);
      if (sha256(packet.identity) !== sha256(identity)) throw new Error("CONFORMANCE_EVENT_EXECUTION_BATCH_IDENTITY_MISMATCH");
      return packet;
    };
    const validateStored = (raw: unknown) => {
      const stored = persistedEventBatchMeasurementSchema.parse(raw);
      const packet = validate(stored.packet);
      if (sha256(packet) !== stored.packetSha256) throw new Error("CONFORMANCE_EVENT_EXECUTION_PACKET_CHECKSUM_MISMATCH");
      return packet;
    };
    const existing = await adapters.readBatch(structuredClone(identity));
    assertActive();
    let packet: EventBatchMeasurementPacket;
    if (existing !== null) {packet = validateStored(existing); resumedBatchCount++;}
    else {
      packet = validate(await adapters.measureBatch({identity: structuredClone(identity), contract: structuredClone(contract)}));
      assertActive();
      await adapters.persistBatch(structuredClone(packet));
      assertActive();
      const readback = await adapters.readBatch(structuredClone(identity));
      assertActive();
      if (readback === null || sha256(validateStored(readback)) !== sha256(packet)) throw new Error("CONFORMANCE_EVENT_EXECUTION_READBACK_MISMATCH");
    }
    const evaluated = evaluateCompositionConformance({contract, previewDocumentHash: packet.previewDocumentHash,
      renderDocumentHash: packet.renderDocumentHash, samples: packet.samples, renderColorTags: packet.renderColorTags});
    const status = evaluated.checkpointBatchCoverage?.localStatus ?? "INCOMPLETE";
    if (status !== "PASS") {
      affectedBatchCount++;
      if (diagnostics.length < EVENT_DIAGNOSTIC_MAX_BATCHES) {
        const frameIndex = evaluated.failures[0]?.frameIndex;
        // Malformed/duplicate foreign frames remain failures, but cannot acquire frozen checkpoint context.
        const authorizedFrame = contract.checkpoints.some((checkpoint) => checkpoint.frameIndex === frameIndex);
        diagnostics.push(buildEventBatchDiagnostic(evaluated, batchIndex, sha256(packet), authorizedFrame ? locateDiagnostic : undefined));
      }
    }
    measuredCheckpointCount += evaluated.checkedCheckpointCount;
    batches.push({batchIndex, packetSha256: sha256(packet), status, measuredCheckpointCount: evaluated.checkedCheckpointCount,
      ...(identity.visualReferenceSha256 ? {visualReferenceSha256: identity.visualReferenceSha256} : {}),
      visualMetrics: eventVisualMetricsFromReport(evaluated, contract)});
  }
  const status = batches.some((batch) => batch.status === "FAIL") ? "FAIL" as const
    : batches.some((batch) => batch.status !== "PASS") || measuredCheckpointCount !== prepared.checkpointCount ? "INCOMPLETE" as const : "PASS" as const;
  return eventBatchExecutionSummarySchema.parse({schemaVersion: 1 as const, scope: "COMPLETE_NATIVE_EVENT_VISUAL_SAMPLE_COVERAGE_NOT_FULL_RENDER_ATTESTATION" as const,
    ...executionScope,
    documentHash, parentContractSha256, planSha256, status,
    requiredBatchCount: prepared.batchCount, measuredBatchCount: batches.length, resumedBatchCount,
    requiredCheckpointCount: prepared.checkpointCount, measuredCheckpointCount, batches,
    diagnostics: {scope: "FIRST_AFFECTED_PARTITIONS_NOT_COMPLETE_FAILURE_LIST", affectedBatchCount,
      omittedBatchCount: affectedBatchCount - diagnostics.length, batches: diagnostics},
    visualMetrics: aggregateEventVisualMetrics(batches.map((batch) => batch.visualMetrics))});
}
