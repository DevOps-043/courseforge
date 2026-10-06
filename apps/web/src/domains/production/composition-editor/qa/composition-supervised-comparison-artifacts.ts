import {createHash} from "node:crypto";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {controlledRenderExecutionObservationSchema} from "../composition-render-execution-contract";
import {renderSupervisorBindingSchema} from "../composition-render-supervisor-receipt";
import {verifyRenderSupervisorReceipt, type TrustedRenderSupervisorKey} from "./composition-render-supervisor-signature";
import {buildControlledComparisonArtifacts} from "./composition-controlled-comparison-artifacts";
import {buildControlledEventComparisonArtifacts} from "./composition-controlled-event-comparison-artifacts";

type SupervisorIntake = {
  expectedBinding: unknown; supervisorReceipt: unknown; trustedKeys: readonly TrustedRenderSupervisorKey[];
  nowMilliseconds: number;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

/** Separate authenticated intake. Legacy local artifacts keep their existing untrusted scope. */
export function buildSupervisedComparisonArtifacts(input: Parameters<typeof buildControlledComparisonArtifacts>[0] & SupervisorIntake) {
  // Authoritative claim/revision/integrity context, never reconstructed from receipt.payload.
  const expected = renderSupervisorBindingSchema.safeParse(input.expectedBinding);
  const contract = compositionConformanceContractSchema.safeParse(input.contract);
  const observation = controlledRenderExecutionObservationSchema.safeParse(input.observation);
  if (!expected.success || !contract.success || !observation.success)
    throw new Error("RENDER_SUPERVISOR_COMPARISON_INPUT_INVALID");
  if (expected.data.artifactKind !== "SINGLE_CONTRACT"
    || expected.data.documentHash !== input.documentHash || expected.data.documentHash !== contract.data.documentHash
    || expected.data.videoSha256 !== input.videoSha256 || expected.data.contractSha256 !== digest(contract.data)
    || expected.data.observationSha256 !== digest(observation.data))
    throw new Error("RENDER_SUPERVISOR_COMPARISON_BINDING_MISMATCH");
  // Retains all font/seek/session checks and pending isolation/color/conformance obligations.
  const artifacts = buildControlledComparisonArtifacts(input);
  if (expected.data.comparisonReceiptSha256 !== digest(artifacts.receipt))
    throw new Error("RENDER_SUPERVISOR_COMPARISON_RECEIPT_MISMATCH");
  const provenance = verifyRenderSupervisorReceipt({receipt: input.supervisorReceipt,
    expectedBinding: expected.data, trustedKeys: input.trustedKeys, nowMilliseconds: input.nowMilliseconds});
  return {...artifacts, provenance};
}

/** Authenticates the independently re-derived complete ordered set, never just the first receipt. */
export function buildSupervisedEventComparisonArtifacts(input: Parameters<typeof buildControlledEventComparisonArtifacts>[0] & SupervisorIntake) {
  const expected = renderSupervisorBindingSchema.safeParse(input.expectedBinding);
  const observation = controlledRenderExecutionObservationSchema.safeParse(input.observation);
  if (!expected.success || !observation.success) throw new Error("RENDER_SUPERVISOR_COMPARISON_INPUT_INVALID");
  const artifacts = buildControlledEventComparisonArtifacts(input);
  if (expected.data.artifactKind !== "EVENT_BATCH_SET" || expected.data.documentHash !== artifacts.coverage.documentHash
    || expected.data.videoSha256 !== artifacts.coverage.videoSha256
    || expected.data.contractSha256 !== artifacts.coverage.parentContractSha256
    || expected.data.observationSha256 !== digest(observation.data))
    throw new Error("RENDER_SUPERVISOR_COMPARISON_BINDING_MISMATCH");
  if (expected.data.comparisonReceiptSha256 !== digest({coverage: artifacts.coverage,
    receipts: artifacts.artifacts.map(artifact => artifact.receipt)}))
    throw new Error("RENDER_SUPERVISOR_COMPARISON_RECEIPT_MISMATCH");
  const provenance = verifyRenderSupervisorReceipt({receipt: input.supervisorReceipt,
    expectedBinding: expected.data, trustedKeys: input.trustedKeys, nowMilliseconds: input.nowMilliseconds});
  return {...artifacts, provenance};
}
