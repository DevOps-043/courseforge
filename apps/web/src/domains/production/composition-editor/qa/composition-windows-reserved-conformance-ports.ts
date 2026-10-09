import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import type {ConformanceRenderReservation} from "./composition-conformance-render-reservation.service";
import {createWindowsComparisonProcessPorts} from "./composition-windows-comparison-process-ports";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

/** Configuration comes only from the operator, never from the reserved document or receipt.
 * Confirmed Job ownership is not restricted-token/ACL/network/resource isolation. */
export function createWindowsReservedConformancePortResolver(input:
  Omit<Parameters<typeof createWindowsComparisonProcessPorts>[0], "descriptor" | "workspace">,
  bridgePorts: Parameters<typeof createWindowsComparisonProcessPorts>[1] = {}) {
  const measurementFence = input.measurementFence;
  const configuration = structuredClone({...input, measurementFence: undefined});
  return (reservation: ConformanceRenderReservation, signal: AbortSignal) => {
    assertConformanceJobActive(signal);
    const contract = compositionConformanceContractSchema.parse(reservation.artifacts.kind === "SINGLE_CONTRACT"
      ? reservation.artifacts.input.contract : reservation.artifacts.input.parentContract);
    return createWindowsComparisonProcessPorts({...configuration, measurementFence,
      descriptor: {organizationId: reservation.scope.organizationId, revisionId: reservation.scope.revisionId,
        executionId: reservation.scope.executionId, documentHash: reservation.binding.documentHash,
        projectHash: reservation.binding.projectHash, contract}}, bridgePorts);
  };
}
