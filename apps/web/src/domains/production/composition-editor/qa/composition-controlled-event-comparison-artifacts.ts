import {createHash} from "node:crypto";
import type {CompositionEditorDocument} from "../composition-document.types";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {prepareCompositionEventBatchContracts} from "../composition-conformance-event-batch-contract";
import {buildControlledComparisonArtifacts} from "./composition-controlled-comparison-artifacts";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Complete local partition assembly. Never authenticates the producer or grants conformity PASS. */
export function buildControlledEventComparisonArtifacts(input: {document: CompositionEditorDocument;
  parentContract: unknown; observation: unknown; videoSha256: string;
  batches: Array<{contract: unknown; seekRepeatability?: unknown; nativeEvidence?: unknown}>}) {
  const parentContract = compositionConformanceContractSchema.parse(input.parentContract);
  const prepared = prepareCompositionEventBatchContracts({document: input.document, parentContract});
  if (parentContract.schemaVersion !== 4 || !parentContract.renderExecution?.seekRepeatabilityPolicy
    || !Array.isArray(input.batches) || input.batches.length !== prepared.batchCount)
    throw new Error("CONTROLLED_RENDER_EVENT_COMPARISON_COVERAGE_INVALID");
  // Validate all contract identities before consuming any measurement, including font/text obligations.
  const contracts = input.batches.map((batch, index) => {
    if (!batch || typeof batch !== "object" || batch.contract === undefined)
      throw new Error("CONTROLLED_RENDER_EVENT_COMPARISON_CONTRACT_INVALID");
    const contract = compositionConformanceContractSchema.parse(batch.contract);
    if (digest(contract) !== prepared.select(index).batchContractSha256)
      throw new Error("CONTROLLED_RENDER_EVENT_COMPARISON_CONTRACT_INVALID");
    return contract;
  });
  const artifacts = contracts.map((contract, index) => buildControlledComparisonArtifacts({contract,
    observation: input.observation, documentHash: prepared.documentHash, videoSha256: input.videoSha256,
    seekRepeatability: input.batches[index]!.seekRepeatability, nativeEvidence: input.batches[index]!.nativeEvidence}));
  const checkpointCount = artifacts.reduce((count, artifact) => count + artifact.receipt.seekRepeatability!.checkpointCount, 0);
  if (checkpointCount !== prepared.checkpointCount) throw new Error("CONTROLLED_RENDER_EVENT_COMPARISON_COVERAGE_INVALID");
  return {artifacts, coverage: {
    scope: "COMPLETE_LOCAL_SDK_EVENT_RECEIPTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION" as const,
    documentHash: prepared.documentHash, videoSha256: input.videoSha256,
    parentContractSha256: prepared.parentContractSha256, planSha256: prepared.planSha256,
    checkpointCount, batchCount: prepared.batchCount,
    batchContractSha256: artifacts.map(artifact => digest(artifact.contract)),
    batchReceiptSha256: artifacts.map(artifact => digest(artifact.receipt)),
  }};
}
