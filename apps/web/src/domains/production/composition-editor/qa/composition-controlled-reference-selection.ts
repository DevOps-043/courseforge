import {createHash} from "node:crypto";
import {z} from "zod";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {COMPOSITION_EVENT_PLAN_MAX_BATCHES} from "../composition-conformance-batch-contract";
import type {ControlledMaterializedExecutor} from "./composition-materialized-supervisor-renderer";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const controlledMeasurementReferencesSchema = z.array(z.object({batchIndex: z.number().int().nonnegative(),
  visualChecksum: hash, audioChecksum: hash.optional()}).strict()).min(1).max(COMPOSITION_EVENT_PLAN_MAX_BATCHES);
export const controlledReferenceSelectionSchema = z.object({
  scope: z.literal("HOST_AUTHORIZED_EXACT_REFERENCE_SELECTION_NOT_DURABLE_ATTESTATION"),
  organizationId: z.string().uuid(), revisionId: z.string().uuid(), executionId: z.string().uuid(),
  documentHash: hash, projectHash: hash, contractSha256: hash,
  references: controlledMeasurementReferencesSchema,
}).strict();
type Descriptor = Parameters<ControlledMaterializedExecutor>[0];
export type ControlledReferenceSelection = z.output<typeof controlledReferenceSelectionSchema>;
type Selection = ControlledReferenceSelection;
const maximumSelections = 1024;

/** Pure host binding for references produced by an already-authorized capture/persistence workflow.
 * It does not authorize captures, query latest, issue a job lease or make an in-memory reservation durable. */
export function bindControlledReferenceSelection(descriptor: Descriptor,
  referencesInput: z.input<typeof controlledMeasurementReferencesSchema>): Selection {
  const contract = compositionConformanceContractSchema.parse(descriptor.contract);
  if (contract.schemaVersion !== 4 || !contract.renderExecution || contract.documentHash !== descriptor.documentHash
    || contract.checkpointBatch && contract.checkpointBatch.batchIndex !== 0)
    throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_CONTRACT_INVALID");
  const references = controlledMeasurementReferencesSchema.parse(referencesInput);
  const count = contract.checkpointBatch?.batchCount ?? 1;
  if (references.length !== count || references.some((reference, index) => reference.batchIndex !== index
    || contract.audio.required !== Boolean(reference.audioChecksum)))
    throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_COVERAGE_INVALID");
  return controlledReferenceSelectionSchema.parse({
    scope: "HOST_AUTHORIZED_EXACT_REFERENCE_SELECTION_NOT_DURABLE_ATTESTATION",
    organizationId: descriptor.organizationId, revisionId: descriptor.revisionId, executionId: descriptor.executionId,
    documentHash: descriptor.documentHash, projectHash: descriptor.projectHash,
    contractSha256: createHash("sha256").update(JSON.stringify(contract)).digest("hex"), references,
  });
}

/** Immutable bounded operator configuration. Unknown executions fail closed; no reuse across retries.
 * Selections and returned values are cloned, so caller edits cannot replace a pending execution's references. */
export function createControlledReferenceSelectionResolver(rawSelections: z.input<typeof controlledReferenceSelectionSchema>[]) {
  if (!Array.isArray(rawSelections) || !rawSelections.length || rawSelections.length > maximumSelections)
    throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_CONFIGURATION_INVALID");
  const selections = new Map<string, Selection>();
  for (const raw of rawSelections) {
    const selection = controlledReferenceSelectionSchema.parse(raw);
    if (selections.has(selection.executionId)) throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_DUPLICATE");
    selections.set(selection.executionId, structuredClone(selection));
  }
  return async (descriptor: Descriptor) => {
    const selected = selections.get(descriptor.executionId);
    if (!selected) throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_UNAVAILABLE");
    const bound = bindControlledReferenceSelection(descriptor, selected.references);
    if (JSON.stringify(bound) !== JSON.stringify(selected))
      throw new Error("CONTROLLED_RENDER_REFERENCE_SELECTION_BINDING_INVALID");
    return structuredClone(bound.references);
  };
}
