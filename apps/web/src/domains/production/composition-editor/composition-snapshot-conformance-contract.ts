import { buildCompositionConformanceContract, compositionConformanceContractSchema } from "./composition-preview-render-conformance";
import { buildTextParityCheckpointPlans } from "./composition-text-checkpoint-plan";
import { COMPOSITION_TEXT_PARITY_POLICY } from "./composition-text-parity-policy";
import { NATIVE_MOTION_VISIBILITY_POLICY, type NativeTextVisibilityPolicy } from "./composition-text-parity-contract";
import { buildDeclaredNativeFontUsageContract, type ConformanceFontManifest } from "./composition-conformance-font-bindings";
import { EXPORTED_COLOR_TAG_POLICY } from "./composition-color-tag-policy";
import { COMPOSITION_EVENT_CHECKPOINT_POLICY } from "./composition-conformance-checkpoint-policy";
import { selectCompositionEventCheckpointBatch } from "./composition-conformance-batch-identity";

/** Server-only producer: freeze expectations from the saved document, never from captured DOM metadata. */
export function buildSnapshotConformanceContract(input: Omit<Parameters<typeof buildCompositionConformanceContract>[0], "contractVersion"> & {contractVersion?: 1 | 2 | 3 | 4; motionVisibility?: boolean; visibilityPolicy?: NativeTextVisibilityPolicy; fontUsage?: boolean; fontManifest?: ConformanceFontManifest; colorTags?: boolean; eventCheckpoints?: boolean; eventBatchIndex?: number}) {
  const base = buildCompositionConformanceContract({...input, contractVersion: input.contractVersion === 4 ? 3 : input.contractVersion});
  if (input.contractVersion !== 4) return base;
  const selection = input.eventCheckpoints ? selectCompositionEventCheckpointBatch(input.document, input.eventBatchIndex) : undefined;
  const checkpoints = selection?.checkpoints ?? base.checkpoints;
  if (input.fontUsage && input.fontManifest === undefined) throw new Error("CONFORMANCE_FONT_CONTRACT_MANIFEST_MISSING");
  const visibilityPolicy = input.visibilityPolicy ?? (input.motionVisibility === true ? NATIVE_MOTION_VISIBILITY_POLICY : undefined);
  return compositionConformanceContractSchema.parse({...base, schemaVersion: 4,
    checkpoints, ...(selection ? {checkpointPolicy: COMPOSITION_EVENT_CHECKPOINT_POLICY, checkpointBatch: selection.batch} : {}),
    ...(input.colorTags === true ? {colorTagPolicy: EXPORTED_COLOR_TAG_POLICY} : {}),
    ...(input.fontUsage ? {fontUsageContract: buildDeclaredNativeFontUsageContract(input.document, input.fontManifest)} : {}), textParity: {
    policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS",
    ...(visibilityPolicy ? {visibilityPolicy} : {}),
    checkpoints: buildTextParityCheckpointPlans(input.document, checkpoints, visibilityPolicy ?? false),
  }});
}
