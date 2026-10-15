import {createHash} from "node:crypto";
import {z} from "zod";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {controlledRenderExecutionObservationSchema} from "../composition-render-execution-contract";
import {buildControlledComparisonArtifacts} from "./composition-controlled-comparison-artifacts";
import {buildControlledEventComparisonArtifacts} from "./composition-controlled-event-comparison-artifacts";

export type ControlledSupervisorArtifacts =
  | {kind: "SINGLE_CONTRACT"; input: Parameters<typeof buildControlledComparisonArtifacts>[0]}
  | {kind: "EVENT_BATCH_SET"; input: Parameters<typeof buildControlledEventComparisonArtifacts>[0]};
type AuthorityBindingContext = {organizationId: string; requestId: string; revisionId: string; productionJobId: string;
  executionId: string; attempt: number; challengeSha256: string; artifactKind: "SINGLE_CONTRACT" | "EVENT_BATCH_SET";
  documentHash: string; projectHash: string; contractSha256: string; contract: z.output<typeof compositionConformanceContractSchema>};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value),"utf8").digest("hex");

/** Independently builds the same binding at signing and admission; no caller-supplied signed binding is copied. */
export function buildControlledSupervisorBinding(context: AuthorityBindingContext, input: ControlledSupervisorArtifacts,
  output: {sha256: string; sizeBytes: number}) {
  const artifacts = input.kind === "SINGLE_CONTRACT" ? buildControlledComparisonArtifacts(input.input)
    : buildControlledEventComparisonArtifacts(input.input);
  const observation = controlledRenderExecutionObservationSchema.parse(input.input.observation);
  const contractSha256 = "receipt" in artifacts ? digest(artifacts.contract) : artifacts.coverage.parentContractSha256;
  const documentHash = "receipt" in artifacts ? artifacts.receipt.documentHash : artifacts.coverage.documentHash;
  const videoSha256 = "receipt" in artifacts ? artifacts.receipt.videoSha256 : artifacts.coverage.videoSha256;
  if (input.kind !== context.artifactKind || contractSha256 !== context.contractSha256
    || documentHash !== context.documentHash || observation.documentHash !== context.documentHash
    || videoSha256 !== output.sha256 || observation.videoSha256 !== output.sha256)
    throw new Error("RENDER_SUPERVISOR_COMPARISON_BINDING_MISMATCH");
  return {organizationId: context.organizationId, requestId: context.requestId,
    revisionId: context.revisionId, productionJobId: context.productionJobId, executionId: context.executionId,
    attempt: context.attempt, challengeSha256: context.challengeSha256, artifactKind: context.artifactKind,
    documentHash: context.documentHash, projectHash: context.projectHash, contractSha256: context.contractSha256,
    observationSha256: digest(observation), comparisonReceiptSha256: "receipt" in artifacts ? digest(artifacts.receipt)
      : digest({coverage: artifacts.coverage, receipts: artifacts.artifacts.map(artifact => artifact.receipt)}),
    videoSha256: output.sha256, sizeBytes: output.sizeBytes};
}
