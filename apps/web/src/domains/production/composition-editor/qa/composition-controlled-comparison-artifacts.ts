import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {exportedVideoReceiptSchema} from "./composition-exported-video-conformance";
import {bindControlledSeekRepeatability} from "./composition-controlled-seek-binding";
import {bindControlledRendererFontWitness} from "./composition-controlled-font-witness";

/** Produces comparator inputs only. Local observations never grant job provenance or isolation. */
export function buildControlledComparisonArtifacts(input: {
  contract: unknown; observation: unknown; documentHash: string; videoSha256: string; seekRepeatability?: unknown; nativeEvidence?: unknown;
}) {
  const contract = compositionConformanceContractSchema.parse(input.contract);
  if (contract.schemaVersion !== 4 || !contract.renderExecution)
    throw new Error("CONTROLLED_RENDER_COMPARISON_EXPECTATION_REQUIRED");
  if (contract.documentHash !== input.documentHash)
    throw new Error("CONTROLLED_RENDER_COMPARISON_DOCUMENT_MISMATCH");
  const execution = evaluateControlledRenderExecution({expected: contract.renderExecution,
    observation: input.observation, documentHash: input.documentHash, videoSha256: input.videoSha256});
  if (execution.status !== "MATCH") throw new Error("CONTROLLED_RENDER_COMPARISON_EXECUTION_MISMATCH");
  const seekRepeatability = bindControlledSeekRepeatability(contract, input.seekRepeatability);
  if (contract.renderExecution.seekRepeatabilityPolicy && !seekRepeatability)
    throw new Error("CONTROLLED_RENDER_COMPARISON_SEEK_REQUIRED");
  const native = bindControlledRendererFontWitness(contract, input.nativeEvidence, input.videoSha256);
  if (contract.fontUsageContract?.bindings.length && !native)
    throw new Error("CONTROLLED_RENDER_COMPARISON_FONT_REQUIRED");
  const receipt = exportedVideoReceiptSchema.parse({documentHash: input.documentHash,
    videoSha256: input.videoSha256, renderExecution: input.observation, ...(seekRepeatability ? {seekRepeatability} : {}),
    ...(native ? {nativeEvidence: native.nativeEvidence} : {})});
  return {contract, receipt, execution};
}
