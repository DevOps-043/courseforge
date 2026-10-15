import {createHash} from "node:crypto";
import {bindControlledReferenceSelection, controlledReferenceSelectionSchema} from "./composition-controlled-reference-selection";
import type {ConformanceRenderEvidenceReservation, recoverConformanceRenderEvidence} from "./composition-conformance-render-evidence";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";

/** Host-selected checksums matched to independently verified consumed execution, not distributed authority. */
export function bindConformanceReferenceReservation(reservation: ConformanceRenderEvidenceReservation,
  admitted: Awaited<ReturnType<typeof recoverConformanceRenderEvidence>>, rawSelection: unknown) {
  const selected = controlledReferenceSelectionSchema.parse(rawSelection);
  const contract = compositionConformanceContractSchema.parse(reservation.artifacts.kind === "SINGLE_CONTRACT"
    ? reservation.artifacts.input.contract : reservation.artifacts.input.parentContract);
  const bound = bindControlledReferenceSelection({organizationId: admitted.binding.organizationId,
    revisionId: admitted.binding.revisionId, executionId: admitted.binding.executionId,
    documentHash: admitted.binding.documentHash, projectHash: admitted.binding.projectHash, contract}, selected.references);
  if (JSON.stringify(bound) !== JSON.stringify(selected) || bound.contractSha256 !== admitted.contractSha256
    || selected.references.length !== admitted.batches.length)
    throw new Error("CONFORMANCE_JOB_REFERENCE_RESERVATION_MISMATCH");
  return {selection: bound, selectionSha256: createHash("sha256").update(JSON.stringify(bound), "utf8").digest("hex")};
}
