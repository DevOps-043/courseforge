import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { eventBatchMeasurementIdentitySchema, eventBatchMeasurementPacketSchema,
  type EventBatchMeasurementAdapters, type EventBatchMeasurementIdentity } from "./composition-conformance-event-batch-execution";
import { prepareAndPersistVisualConformanceReference } from "./composition-conformance-reference-pipeline";
import { measureCompositionEventBatchWithPersistedReference } from "./composition-conformance-event-batch-measurement";
import { persistCompositionEventBatchMeasurement, readCompositionEventBatchMeasurement } from "./composition-conformance-event-batch-persistence";
import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";
import {z} from "zod";

const defaultDependencies = {prepareVisual: prepareAndPersistVisualConformanceReference,
  measure: measureCompositionEventBatchWithPersistedReference,
  readPacket: readCompositionEventBatchMeasurement, persistPacket: persistCompositionEventBatchMeasurement};

/** Compose actual worker adapters. The root and local video must already pass revision/integrity verification. */
export function createPersistedCompositionEventBatchAdapters(params: {
  supabase: SupabaseClient<any, any, any>; supabaseUrl: string; rootIdentity: EventBatchMeasurementIdentity;
  outputParentDirectory: string; videoPath: string; renderReceiptPath: string; signal?: AbortSignal;
  processPorts?: ComparisonProcessPorts;
  visualReferenceChecksums?: string[];
  resolveRenderReceipt?: (contractSha256: string, batchIndex: number) => {path: string; sha256: string};
}, dependencies: typeof defaultDependencies = defaultDependencies): EventBatchMeasurementAdapters {
  const root = eventBatchMeasurementIdentitySchema.parse(params.rootIdentity);
  if (root.batch.batchIndex !== 0 || root.parentContractSha256 !== root.batchContractSha256) {
    throw new Error("CONFORMANCE_EVENT_ADAPTER_ROOT_REQUIRED");
  }
  const {supabase, supabaseUrl, outputParentDirectory, videoPath, renderReceiptPath, signal} = params;
  const visualReferences = params.visualReferenceChecksums === undefined ? undefined
    : z.array(z.string().regex(/^[a-f0-9]{64}$/)).length(root.batch.batchCount).parse(params.visualReferenceChecksums);
  if (visualReferences && !params.resolveRenderReceipt)
    throw new Error("CONFORMANCE_EVENT_ADAPTER_ADMITTED_RECEIPTS_REQUIRED_INVALID");
  const operations = {...dependencies};
  const captureChecksums = new Map<string, string>();
  const assertActive = () => {if (signal?.aborted) throw new Error("CONFORMANCE_EVENT_EXECUTION_ABORTED");};
  const validateIdentity = (input: unknown) => {
    assertActive();
    const identity = eventBatchMeasurementIdentitySchema.parse(input);
    const sameScope = (['organizationId', 'revisionId', 'projectHash', 'videoSha256', 'documentHash', 'parentContractSha256'] as const)
      .every((key) => identity[key] === root[key]);
    if (!sameScope || JSON.stringify({...identity.batch, batchIndex: 0}) !== JSON.stringify(root.batch)) {
      throw new Error("CONFORMANCE_EVENT_ADAPTER_SCOPE_MISMATCH");
    }
    if (Boolean(visualReferences) !== Boolean(identity.visualReferenceSha256)
      || visualReferences && identity.visualReferenceSha256 !== visualReferences[identity.batch.batchIndex])
      throw new Error("CONFORMANCE_EVENT_ADAPTER_REFERENCE_SELECTION_MISMATCH");
    return identity;
  };
  const identityKey = (identity: EventBatchMeasurementIdentity) => JSON.stringify(identity);
  return {
    async readBatch(input) {
      const identity = validateIdentity(input);
      const stored = await operations.readPacket({supabase, identity}); assertActive(); return stored;
    },
    async measureBatch(input) {
      const identity = validateIdentity(input.identity);
      const contract = compositionConformanceContractSchema.parse(input.contract);
      if (contract.documentHash !== identity.documentHash || contract.schemaVersion !== 4
        || JSON.stringify(contract.checkpointBatch) !== JSON.stringify(identity.batch)
        || createHash("sha256").update(JSON.stringify(contract)).digest("hex") !== identity.batchContractSha256) {
        throw new Error("CONFORMANCE_EVENT_ADAPTER_CONTRACT_MISMATCH");
      }
      const visual = identity.visualReferenceSha256 ? {organizationId: root.organizationId, revisionId: root.revisionId,
        projectHash: root.projectHash, documentHash: root.documentHash, checksum: identity.visualReferenceSha256}
        : await operations.prepareVisual({supabase, supabaseUrl, organizationId: root.organizationId,
          revisionId: root.revisionId, outputParentDirectory, signal, eventBatchIndex: identity.batch.batchIndex});
      assertActive();
      if (visual.organizationId !== root.organizationId || visual.revisionId !== root.revisionId
        || visual.projectHash !== root.projectHash || visual.documentHash !== root.documentHash) {
        throw new Error("CONFORMANCE_EVENT_ADAPTER_REFERENCE_MISMATCH");
      }
      const admittedReceipt = params.resolveRenderReceipt?.(identity.batchContractSha256, identity.batch.batchIndex);
      const packet = eventBatchMeasurementPacketSchema.parse(await operations.measure({identity: structuredClone(identity), contract: structuredClone(contract),
        comparison: {supabase, checksum: visual.checksum, outputParentDirectory, videoPath,
          renderReceiptPath: admittedReceipt?.path ?? renderReceiptPath,
          ...(admittedReceipt ? {expectedContractSha256: identity.batchContractSha256, expectedRenderReceiptSha256: admittedReceipt.sha256} : {}),
          signal, processPorts: params.processPorts}}));
      assertActive();
      if (identityKey(packet.identity) !== identityKey(identity)) throw new Error("CONFORMANCE_EVENT_ADAPTER_PACKET_MISMATCH");
      captureChecksums.set(identityKey(identity), visual.checksum);
      return packet;
    },
    async persistBatch(input) {
      const packet = eventBatchMeasurementPacketSchema.parse(input);
      const identity = validateIdentity(packet.identity), key = identityKey(identity);
      const visualChecksum = captureChecksums.get(key);
      if (!visualChecksum) throw new Error("CONFORMANCE_EVENT_ADAPTER_MEASUREMENT_REQUIRED");
      await operations.persistPacket({supabase, packet, visualChecksum});
      captureChecksums.delete(key); assertActive();
    },
  };
}
