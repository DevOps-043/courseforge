import {createHash} from "node:crypto";
import {z} from "zod";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {controlledFontUsageWitnessSchema} from "../composition-font-usage-contract";
import {controlledFontUsageEvidenceSchema, validateControlledFontUsageEvidence} from "./composition-controlled-font-capture";
import {textParityEvidenceSchema, textParityEvidenceHash} from "./composition-text-parity-evidence";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const controlledNativeEvidenceSchema = z.object({
  scope: z.literal("SDK_SESSION_NATIVE_TEXT_AND_CUSTOM_GLYPHS_NOT_PREVIEW_PARITY"),
  textEvidence: textParityEvidenceSchema,
  fontEvidence: controlledFontUsageEvidenceSchema,
}).strict();

/** Validate the full receipt before deriving its path/text-free durable summary. */
export function bindControlledRendererFontWitness(contractInput: unknown, input: unknown, videoSha256: string) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  if (input === undefined) return undefined;
  const nativeEvidence = controlledNativeEvidenceSchema.parse(input);
  const evidence = validateControlledFontUsageEvidence(nativeEvidence.fontEvidence, contract, nativeEvidence.textEvidence);
  const summary = controlledFontUsageWitnessSchema.parse({policy: evidence.policy, scope: evidence.scope,
    status: "OBSERVED_UNATTESTED", documentHash: evidence.documentHash, contractSha256: evidence.contractSha256,
    videoSha256, manifestSha256: evidence.manifestSha256, evidenceSha256: digest(evidence),
    textEvidenceSha256: textParityEvidenceHash(nativeEvidence.textEvidence), checkpointCount: evidence.checkpoints.length,
    bindingCount: evidence.bindings.length, elementCount: evidence.checkpoints.reduce((count, point) => count + point.elements.length, 0)});
  assertControlledFontWitnessMatchesContract(contract, summary, videoSha256);
  return {nativeEvidence, summary};
}

/** Independent finalizer binding. Hashes identify a local witness, not its authority. */
export function assertControlledFontWitnessMatchesContract(contractInput: unknown, input: unknown, videoSha256: string) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  const summary = controlledFontUsageWitnessSchema.parse(input);
  if (contract.schemaVersion !== 4 || !contract.renderExecution || !contract.fontUsageContract?.bindings.length)
    throw new Error("CONFORMANCE_RENDER_FONT_WITNESS_UNAUTHORIZED");
  const owners = new Set(contract.fontUsageContract.bindings.map(binding => binding.elementId));
  const elementCount = contract.textParity.checkpoints.reduce((count, point) => count
    + point.expectedTexts.filter(text => owners.has(text.elementId)).length, 0);
  if (summary.documentHash !== contract.documentHash || summary.contractSha256 !== digest(contract)
    || summary.videoSha256 !== videoSha256 || summary.manifestSha256 !== contract.fontUsageContract.manifestSha256
    || summary.bindingCount !== owners.size || summary.checkpointCount !== contract.textParity.checkpoints.length
    || summary.elementCount !== elementCount)
    throw new Error("CONFORMANCE_RENDER_FONT_WITNESS_BINDING_INVALID");
  return summary;
}
