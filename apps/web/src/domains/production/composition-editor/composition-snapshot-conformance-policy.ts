import { compositionConformanceContractSchema, type CompositionConformanceContract } from "./composition-preview-render-conformance";
import { NATIVE_MOTION_VISIBILITY_POLICY, NATIVE_TRANSITION_VISIBILITY_POLICY, NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TEXT_GEOMETRY_POLICY } from "./composition-text-parity-contract";

const VISIBILITY_POLICY_MANIFEST_PATH = "manifest->conformance_contract->textParity->>visibilityPolicy";
const FONT_USAGE_POLICY_MANIFEST_PATH = "manifest->conformance_contract->fontUsageContract->>policy";
const COLOR_TAG_POLICY_MANIFEST_PATH = "manifest->conformance_contract->>colorTagPolicy";
const EVENT_CHECKPOINT_POLICY_MANIFEST_PATH = "manifest->conformance_contract->>checkpointPolicy";
const PAINT_MASK_POLICY_MANIFEST_PATH = "manifest->conformance_contract->textParity->>paintMaskPolicy";
const PAINT_EXPANSION_POLICY_MANIFEST_PATH = "manifest->conformance_contract->textParity->>paintRegionExpansionPolicy";
const PAINT_OFFCANVAS_POLICY_MANIFEST_PATH = "manifest->conformance_contract->textParity->>paintOffcanvasSeedPolicy";
const DECK_TEXT_POLICY_MANIFEST_PATH = "manifest->conformance_contract->deckTextPlan->>policy";

export function restrictSnapshotDeckTextReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.deckTextPlan?.policy : undefined;
  const filtered = policy ? query.eq(DECK_TEXT_POLICY_MANIFEST_PATH, policy) : query.is(DECK_TEXT_POLICY_MANIFEST_PATH, null);
  const paint = contract.schemaVersion === 4 ? contract.deckTextPaintMaskPolicy : undefined;
  const path = "manifest->conformance_contract->>deckTextPaintMaskPolicy";
  return paint ? filtered.eq(path, paint) : filtered.is(path, null);
}

export function restrictSnapshotPaintMaskReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.textParity.paintMaskPolicy : undefined;
  const filtered = policy ? query.eq(PAINT_MASK_POLICY_MANIFEST_PATH, policy) : query.is(PAINT_MASK_POLICY_MANIFEST_PATH, null);
  const expansion = contract.schemaVersion === 4 ? contract.textParity.paintRegionExpansionPolicy : undefined;
  const expanded = expansion ? filtered.eq(PAINT_EXPANSION_POLICY_MANIFEST_PATH, expansion) : filtered.is(PAINT_EXPANSION_POLICY_MANIFEST_PATH, null);
  const offcanvas = contract.schemaVersion === 4 ? contract.textParity.paintOffcanvasSeedPolicy : undefined;
  return offcanvas ? expanded.eq(PAINT_OFFCANVAS_POLICY_MANIFEST_PATH, offcanvas) : expanded.is(PAINT_OFFCANVAS_POLICY_MANIFEST_PATH, null);
}

/** This flag cannot silently upgrade a legacy contract or enable text rollout. */
export function snapshotMotionVisibilityEnabled(contractVersion: number, raw: string | undefined) {
  return contractVersion === 4 && raw === "true";
}

export function resolveSnapshotTextVisibilityPolicy(contractVersion: number, motionFlag: string | undefined, transitionFlag: string | undefined, appearanceFlag?: string, geometryFlag?: string) {
  if (contractVersion !== 4) return undefined;
  if (geometryFlag === "true") return NATIVE_TEXT_GEOMETRY_POLICY;
  if (appearanceFlag === "true") return NATIVE_TEXT_APPEARANCE_POLICY;
  if (transitionFlag === "true") return NATIVE_TRANSITION_VISIBILITY_POLICY;
  return snapshotMotionVisibilityEnabled(contractVersion, motionFlag) ? NATIVE_MOTION_VISIBILITY_POLICY : undefined;
}

type PolicyQuery<Query> = {
  eq(column: string, value: string): Query;
  is(column: string, value: null): Query;
};

export function restrictSnapshotRenderExecutionReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.renderExecution?.policy : undefined;
  const path = "manifest->conformance_contract->renderExecution->>policy";
  return policy ? query.eq(path, policy) : query.is(path, null);
}

/** JSON containment alone permits supersets and could reuse a stronger/different contract. */
export function restrictSnapshotVisibilityReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.textParity.visibilityPolicy : undefined;
  return policy ? query.eq(VISIBILITY_POLICY_MANIFEST_PATH, policy) : query.is(VISIBILITY_POLICY_MANIFEST_PATH, null);
}

export function restrictSnapshotFontUsageReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.fontUsageContract?.policy : undefined;
  return policy ? query.eq(FONT_USAGE_POLICY_MANIFEST_PATH, policy) : query.is(FONT_USAGE_POLICY_MANIFEST_PATH, null);
}

/** Match presence and absence exactly; JSON containment alone permits stronger contracts. */
export function restrictSnapshotColorTagReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.colorTagPolicy : undefined;
  return policy ? query.eq(COLOR_TAG_POLICY_MANIFEST_PATH, policy) : query.is(COLOR_TAG_POLICY_MANIFEST_PATH, null);
}

/** Event coverage policy is part of revision identity, including its absence. */
export function restrictSnapshotEventCheckpointReuse<Query extends PolicyQuery<Query>>(query: Query, contract: CompositionConformanceContract): Query {
  const policy = contract.schemaVersion === 4 ? contract.checkpointPolicy : undefined;
  return policy ? query.eq(EVENT_CHECKPOINT_POLICY_MANIFEST_PATH, policy) : query.is(EVENT_CHECKPOINT_POLICY_MANIFEST_PATH, null);
}

/** Defense in depth: validate the actual stored contract before activating an existing revision. */
export function assertSnapshotVisibilityReuse(manifest: unknown, requested: CompositionConformanceContract) {
  if (!manifest || typeof manifest !== "object" || !("conformance_contract" in manifest)) throw new Error("CONFORMANCE_SNAPSHOT_POLICY_MISMATCH");
  const stored = compositionConformanceContractSchema.safeParse(manifest.conformance_contract);
  if (!stored.success || stored.data.schemaVersion !== requested.schemaVersion || stored.data.documentHash !== requested.documentHash) {
    throw new Error("CONFORMANCE_SNAPSHOT_POLICY_MISMATCH");
  }
  if (JSON.stringify(stored.data.schemaVersion === 4 ? stored.data.renderExecution : undefined)
    !== JSON.stringify(requested.schemaVersion === 4 ? requested.renderExecution : undefined))
    throw new Error("CONFORMANCE_SNAPSHOT_RENDER_EXECUTION_MISMATCH");
  const storedEvents = stored.data.schemaVersion === 4 ? stored.data.checkpointPolicy : undefined;
  const requestedEvents = requested.schemaVersion === 4 ? requested.checkpointPolicy : undefined;
  if (storedEvents !== requestedEvents || (requestedEvents && JSON.stringify(stored.data.checkpoints) !== JSON.stringify(requested.checkpoints))) {
    throw new Error("CONFORMANCE_SNAPSHOT_EVENT_POLICY_MISMATCH");
  }
  const storedBatch = stored.data.schemaVersion === 4 ? stored.data.checkpointBatch : undefined;
  const requestedBatch = requested.schemaVersion === 4 ? requested.checkpointBatch : undefined;
  if (JSON.stringify(storedBatch) !== JSON.stringify(requestedBatch)) throw new Error("CONFORMANCE_SNAPSHOT_EVENT_POLICY_MISMATCH");
  const storedPolicy = stored.data.schemaVersion === 4 ? stored.data.textParity.visibilityPolicy : undefined;
  const requestedPolicy = requested.schemaVersion === 4 ? requested.textParity.visibilityPolicy : undefined;
  if (storedPolicy !== requestedPolicy) {
    throw new Error("CONFORMANCE_SNAPSHOT_POLICY_MISMATCH");
  }
  if (requested.schemaVersion === 4 && stored.data.schemaVersion === 4
    && JSON.stringify(stored.data.textParity) !== JSON.stringify(requested.textParity)) {
    throw new Error("CONFORMANCE_SNAPSHOT_POLICY_MISMATCH");
  }
  const storedFonts = stored.data.schemaVersion === 4 ? stored.data.fontUsageContract : undefined;
  const storedDeckText = stored.data.schemaVersion === 4 ? stored.data.deckTextPlan : undefined;
  const requestedDeckText = requested.schemaVersion === 4 ? requested.deckTextPlan : undefined;
  if (JSON.stringify(storedDeckText) !== JSON.stringify(requestedDeckText)) throw new Error("CONFORMANCE_SNAPSHOT_DECK_TEXT_MISMATCH");
  if ((stored.data.schemaVersion === 4 ? stored.data.deckTextPaintMaskPolicy : undefined)
    !== (requested.schemaVersion === 4 ? requested.deckTextPaintMaskPolicy : undefined)) throw new Error("CONFORMANCE_SNAPSHOT_DECK_PAINT_POLICY_MISMATCH");
  const requestedFonts = requested.schemaVersion === 4 ? requested.fontUsageContract : undefined;
  if (JSON.stringify(storedFonts) !== JSON.stringify(requestedFonts)) throw new Error("CONFORMANCE_SNAPSHOT_FONT_CONTRACT_MISMATCH");
  const storedColor = stored.data.schemaVersion === 4 ? stored.data.colorTagPolicy : undefined;
  const requestedColor = requested.schemaVersion === 4 ? requested.colorTagPolicy : undefined;
  if (storedColor !== requestedColor) throw new Error("CONFORMANCE_SNAPSHOT_COLOR_POLICY_MISMATCH");
}
