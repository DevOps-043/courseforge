import {createHash} from "node:crypto";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {controlledNativeEvidenceSchema, bindControlledRendererFontWitness} from "./composition-controlled-font-witness";
import {validateTextParityEvidence} from "./composition-text-parity-evidence";
import {attachControlledOriginalSeekReport} from "./composition-controlled-seek-binding";

/** Native geometry is useful without custom fonts, but never proves paint parity or provenance. */
export function bindControlledRendererNativeEvidence(contractInput: unknown, input: unknown, videoSha256: string) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  if (input === undefined) return undefined;
  if (contract.schemaVersion !== 4 || !contract.renderExecution)
    throw new Error("CONFORMANCE_RENDER_NATIVE_EVIDENCE_UNAUTHORIZED");
  const parsed = controlledNativeEvidenceSchema.parse(input);
  const textEvidence = validateTextParityEvidence(parsed.textEvidence, contract, "RENDERER_GEOMETRY");
  if (contract.fontUsageContract?.bindings.length) {
    const bound = bindControlledRendererFontWitness(contract, {...parsed, textEvidence}, videoSha256)!;
    return {nativeEvidence: bound.nativeEvidence, fontWitness: bound.summary};
  }
  // A receipt cannot invent a custom-font obligation outside the frozen contract.
  if (parsed.fontEvidence) throw new Error("CONFORMANCE_RENDER_FONT_WITNESS_UNAUTHORIZED");
  return {nativeEvidence: {...parsed, textEvidence}, fontWitness: undefined};
}

/** Attach the collected parent witness only to the identical single contract, never to event partitions. */
export function attachOriginalNativeSingleComparison<T extends {
  contract: unknown; documentHash: string; videoSha256: string; nativeEvidence?: unknown; seekRepeatability?: unknown;
}>(input: {
  expectedContract: unknown;
  artifacts: {kind: "SINGLE_CONTRACT"; input: T};
  originalNative: {documentHash: string; video: {sha256: string}; nativeEvidence: unknown; seekRepeatability?: unknown};
}) {
  const expected = compositionConformanceContractSchema.parse(input.expectedContract);
  const actual = compositionConformanceContractSchema.parse(input.artifacts.input.contract);
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const receipt = input.originalNative;
  if (hash(expected) !== hash(actual) || receipt.documentHash !== expected.documentHash
    || input.artifacts.input.documentHash !== receipt.documentHash
    || input.artifacts.input.videoSha256 !== receipt.video.sha256)
    throw new Error("CONTROLLED_RENDER_ORIGINAL_NATIVE_COMPARISON_BINDING_INVALID");
  const bound = bindControlledRendererNativeEvidence(expected, receipt.nativeEvidence, receipt.video.sha256)!;
  const supplied = input.artifacts.input.nativeEvidence;
  if (supplied !== undefined) {
    const measured = bindControlledRendererNativeEvidence(expected, supplied, receipt.video.sha256)!;
    if (hash(measured.nativeEvidence) !== hash(bound.nativeEvidence))
      throw new Error("CONTROLLED_RENDER_ORIGINAL_NATIVE_COMPARISON_CONFLICT");
  }
  const seekRepeatability = attachControlledOriginalSeekReport(expected, receipt.seekRepeatability, input.artifacts.input.seekRepeatability);
  return structuredClone({...input.artifacts, input: {...input.artifacts.input, nativeEvidence: bound.nativeEvidence,
    ...(seekRepeatability ? {seekRepeatability} : {})}});
}
