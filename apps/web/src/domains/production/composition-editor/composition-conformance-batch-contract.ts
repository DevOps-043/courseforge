import { z } from "zod";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";
import { COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "./composition-conformance-checkpoint-policy";

export const COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS = COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS * 60;
export const COMPOSITION_EVENT_PLAN_MAX_BATCHES = Math.ceil(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS / COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS);
export const eventCheckpointBatchSchema = z.object({
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  batchIndex: z.number().int().nonnegative(),
  batchCount: z.number().int().positive().max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
  totalCheckpointCount: z.number().int().positive().max(COMPOSITION_EVENT_PLAN_MAX_CHECKPOINTS),
}).strict().superRefine((batch, context) => {
  if (batch.batchIndex >= batch.batchCount
    || batch.batchCount !== Math.ceil(batch.totalCheckpointCount / COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_BATCH_IDENTITY_INVALID"});
  }
});
export type EventCheckpointBatch = z.infer<typeof eventCheckpointBatchSchema>;
/** Compact revision authorization: position in the hash list is the partition index. */
export const eventBatchAuthorizationManifestSchema = z.object({
  schemaVersion: z.literal(1), policy: z.literal("FROZEN_EVENT_PARTITION_CONTRACT_HASHES_V1"),
  scope: z.literal("AUTHORIZED_CONTRACT_IDENTITIES_NOT_MEASUREMENT_COVERAGE"),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), parentContractSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rootBatch: eventCheckpointBatchSchema,
  batchContractSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
}).strict().superRefine((manifest, context) => {
  if (manifest.rootBatch.batchIndex !== 0 || manifest.batchContractSha256.length !== manifest.rootBatch.batchCount
    || manifest.batchContractSha256[0] !== manifest.parentContractSha256
    || new Set(manifest.batchContractSha256).size !== manifest.batchContractSha256.length) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_AUTHORIZATION_MANIFEST_INVALID"});
  }
});
export type EventBatchAuthorizationManifest = z.infer<typeof eventBatchAuthorizationManifestSchema>;
export function eventBatchCheckpointCount(batch: EventCheckpointBatch): number {
  return Math.min(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS,
    batch.totalCheckpointCount - batch.batchIndex * COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS);
}

export const eventCheckpointBatchCoverageSchema = z.object({
  scope: z.literal("ONE_EVENT_PARTITION_NOT_GLOBAL_COVERAGE"),
  batch: eventCheckpointBatchSchema,
  measuredCheckpointCount: z.number().int().nonnegative().max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
  localStatus: z.enum(["PASS", "FAIL", "INCOMPLETE"]),
}).strict().superRefine((coverage, context) => {
  const required = eventBatchCheckpointCount(coverage.batch);
  if (coverage.measuredCheckpointCount > required || (coverage.localStatus === "PASS" && coverage.measuredCheckpointCount !== required)) {
    context.addIssue({code: "custom", message: "CONFORMANCE_EVENT_BATCH_COVERAGE_INVALID"});
  }
});
