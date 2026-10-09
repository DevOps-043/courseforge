import {createHash} from "node:crypto";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {controlledSeekRepeatabilityReportSchema} from "../composition-render-seek-policy";

/** Binding only: local repeatability never authenticates the renderer or grants global PASS. */
export function bindControlledSeekRepeatability(contractInput: unknown, reportInput: unknown) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  const required = contract.schemaVersion === 4 && contract.renderExecution?.seekRepeatabilityPolicy;
  if (!required) {
    if (reportInput !== undefined) throw new Error("CONFORMANCE_RENDER_SEEK_UNAUTHORIZED");
    return undefined;
  }
  if (reportInput === undefined) return undefined;
  const report = controlledSeekRepeatabilityReportSchema.parse(reportInput);
  const expectedHash = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
  const points = [...contract.checkpoints].sort((left, right) => left.frameIndex - right.frameIndex);
  if (report.policy !== required || report.documentHash !== contract.documentHash || report.contractSha256 !== expectedHash
    || report.checkpointCount !== points.length || report.samples.some((sample, index) =>
      sample.frameIndex !== points[index].frameIndex || sample.timeSeconds !== points[index].timeSeconds))
    throw new Error("CONFORMANCE_RENDER_SEEK_BINDING_INVALID");
  return report;
}

/** Original-source report wins only when independently bound; conflicting measurer output is an error. */
export function attachControlledOriginalSeekReport(contract: unknown, original: unknown, supplied: unknown) {
  const bound = bindControlledSeekRepeatability(contract, original);
  const parsed = compositionConformanceContractSchema.parse(contract);
  if (parsed.schemaVersion === 4 && parsed.renderExecution?.seekRepeatabilityPolicy && !bound)
    throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_REQUIRED");
  if (supplied !== undefined) {
    const measured = bindControlledSeekRepeatability(contract, supplied);
    if (JSON.stringify(measured) !== JSON.stringify(bound)) throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_CONFLICT");
  }
  return bound;
}
