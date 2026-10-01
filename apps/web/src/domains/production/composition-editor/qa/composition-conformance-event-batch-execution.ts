import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompositionEditorDocument } from "../composition-document.types";
import { prepareCompositionEventBatchContracts } from "../composition-conformance-event-batch-contract";
import { eventCheckpointBatchSchema } from "../composition-conformance-batch-contract";
import { compositionConformanceSampleSchema, evaluateCompositionConformance,
  type CompositionConformanceContract } from "../composition-preview-render-conformance";
import { exportedColorTagReportSchema } from "../composition-color-tag-policy";
import { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "../composition-conformance-checkpoint-policy";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const eventBatchMeasurementIdentitySchema = z.object({
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), projectHash: hashSchema, videoSha256: hashSchema,
  documentHash: hashSchema, parentContractSha256: hashSchema, batchContractSha256: hashSchema,
  batch: eventCheckpointBatchSchema,
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
}, adapters: EventBatchMeasurementAdapters) {
  const signal = input.signal;
  const assertActive = () => {if (signal?.aborted) throw new Error("CONFORMANCE_EVENT_EXECUTION_ABORTED");};
  assertActive();
  const executionScope = z.object({organizationId: z.string().uuid(), revisionId: z.string().uuid(),
    projectHash: hashSchema, videoSha256: hashSchema}).strict().parse({organizationId: input.organizationId,
    revisionId: input.revisionId, projectHash: input.projectHash, videoSha256: input.videoSha256});
  const prepared = prepareCompositionEventBatchContracts(input);
  const {parentContractSha256, planSha256, documentHash} = prepared;
  let measuredCheckpointCount = 0, resumedBatchCount = 0;
  const batches: Array<{batchIndex: number; packetSha256: string; status: "PASS" | "FAIL" | "INCOMPLETE"; measuredCheckpointCount: number}> = [];
  for (let batchIndex = 0; batchIndex < prepared.batchCount; batchIndex++) {
    assertActive();
    const {contract, batchContractSha256} = prepared.select(batchIndex);
    const identity = eventBatchMeasurementIdentitySchema.parse({...executionScope, documentHash, parentContractSha256,
      batchContractSha256, batch: contract.schemaVersion === 4 ? contract.checkpointBatch : undefined});
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
    measuredCheckpointCount += evaluated.checkedCheckpointCount;
    batches.push({batchIndex, packetSha256: sha256(packet), status, measuredCheckpointCount: evaluated.checkedCheckpointCount});
  }
  const status = batches.some((batch) => batch.status === "FAIL") ? "FAIL" as const
    : batches.some((batch) => batch.status !== "PASS") || measuredCheckpointCount !== prepared.checkpointCount ? "INCOMPLETE" as const : "PASS" as const;
  return {schemaVersion: 1 as const, scope: "COMPLETE_NATIVE_EVENT_VISUAL_SAMPLE_COVERAGE_NOT_FULL_RENDER_ATTESTATION" as const,
    ...executionScope,
    documentHash, parentContractSha256, planSha256, status,
    requiredBatchCount: prepared.batchCount, measuredBatchCount: batches.length, resumedBatchCount,
    requiredCheckpointCount: prepared.checkpointCount, measuredCheckpointCount, batches};
}
