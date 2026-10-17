import { buildCompositionConformanceContract, compositionConformanceContractSchema } from "./composition-preview-render-conformance";
import { buildTextParityCheckpointPlans } from "./composition-text-checkpoint-plan";
import { COMPOSITION_TEXT_PARITY_POLICY, TEXT_PAINT_REGION_EXPANSION_POLICY, OFFCANVAS_TEXT_PAINT_SEED_POLICY } from "./composition-text-parity-policy";
import { NATIVE_MOTION_VISIBILITY_POLICY, NATIVE_TEXT_GEOMETRY_POLICY, NATIVE_TEXT_PAINT_MASK_POLICY, type NativeTextVisibilityPolicy } from "./composition-text-parity-contract";
import { buildDeclaredNativeFontUsageContract, type ConformanceFontManifest } from "./composition-conformance-font-bindings";
import { EXPORTED_COLOR_TAG_POLICY } from "./composition-color-tag-policy";
import { COMPOSITION_EVENT_CHECKPOINT_POLICY } from "./composition-conformance-checkpoint-policy";
import { selectCompositionEventCheckpointBatch } from "./composition-conformance-batch-identity";
import { buildDeckTextPlan } from "./composition-deck-text-plan";
import { DECK_TEXT_PAINT_PAIR_POLICY } from "./composition-deck-text-paint-policy";
import type {ControlledRenderExecutionContract} from "./composition-render-execution-contract";
import type { HtmlEditingFrozenSnapshotBundle } from "./composition-html-editing-snapshot-bundle.server";

type SnapshotConformanceContractInput = Omit<Parameters<typeof buildCompositionConformanceContract>[0], "contractVersion"> & {
  contractVersion?: 1 | 2 | 3 | 4;
  htmlEditingBundle?: HtmlEditingFrozenSnapshotBundle;
  renderExecution?: ControlledRenderExecutionContract;
  deckText?: boolean;
  deckTextPaintMasks?: boolean;
  paintMasks?: boolean;
  motionVisibility?: boolean;
  visibilityPolicy?: NativeTextVisibilityPolicy;
  fontUsage?: boolean;
  fontManifest?: ConformanceFontManifest;
  colorTags?: boolean;
  eventCheckpoints?: boolean;
  eventBatchIndex?: number;
};

/** Server-only producer: freeze expectations from saved source, never captured DOM metadata. */
export function buildSnapshotConformanceContract(input: SnapshotConformanceContractInput) {
  if (input.renderExecution && input.contractVersion !== 4) throw new Error("CONFORMANCE_RENDER_EXECUTION_VERSION_INVALID");
  if (input.deckTextPaintMasks === true && (input.contractVersion !== 4 || input.deckText !== true))
    throw new Error("CONFORMANCE_DECK_PAINT_PLAN_REQUIRED");
  if (input.deckText === true && input.contractVersion !== 4) throw new Error("CONFORMANCE_DECK_TEXT_CONTRACT_VERSION_INVALID");
  if (input.paintMasks === true && input.contractVersion !== 4) throw new Error("CONFORMANCE_TEXT_PAINT_MASK_CONTRACT_VERSION_INVALID");
  const base = buildCompositionConformanceContract({...input, contractVersion: input.contractVersion === 4 ? 3 : input.contractVersion});
  if (input.contractVersion !== 4) return base;
  const selection = input.eventCheckpoints ? selectCompositionEventCheckpointBatch(input.document, input.eventBatchIndex) : undefined;
  const checkpoints = selection?.checkpoints ?? base.checkpoints;
  if (input.fontUsage && input.fontManifest === undefined) throw new Error("CONFORMANCE_FONT_CONTRACT_MANIFEST_MISSING");
  const visibilityPolicy = input.visibilityPolicy ?? (input.motionVisibility === true ? NATIVE_MOTION_VISIBILITY_POLICY : undefined);
  return compositionConformanceContractSchema.parse({...base, schemaVersion: 4,
    ...(input.renderExecution ? {renderExecution: input.renderExecution} : {}),
    checkpoints, ...(selection ? {checkpointPolicy: COMPOSITION_EVENT_CHECKPOINT_POLICY, checkpointBatch: selection.batch} : {}),
    ...(input.colorTags === true ? {colorTagPolicy: EXPORTED_COLOR_TAG_POLICY} : {}),
    ...(input.deckText === true ? {deckTextPlan: buildDeckTextPlan(input.document, input.htmlEditingBundle)} : {}),
    ...(input.deckTextPaintMasks === true ? {deckTextPaintMaskPolicy: DECK_TEXT_PAINT_PAIR_POLICY} : {}),
    ...(input.fontUsage ? {fontUsageContract: buildDeclaredNativeFontUsageContract(input.document, input.fontManifest)} : {}), textParity: {
    policy: COMPOSITION_TEXT_PARITY_POLICY.id, scope: "NATIVE_TEXT_AND_CAPTIONS",
    ...(input.paintMasks === true ? {paintMaskPolicy: NATIVE_TEXT_PAINT_MASK_POLICY,
      paintRegionExpansionPolicy: TEXT_PAINT_REGION_EXPANSION_POLICY} : {}),
    ...(input.paintMasks === true && visibilityPolicy === NATIVE_TEXT_GEOMETRY_POLICY ? {paintOffcanvasSeedPolicy: OFFCANVAS_TEXT_PAINT_SEED_POLICY} : {}),
    ...(visibilityPolicy ? {visibilityPolicy} : {}),
    checkpoints: buildTextParityCheckpointPlans(input.document, checkpoints, visibilityPolicy ?? false),
  }});
}
