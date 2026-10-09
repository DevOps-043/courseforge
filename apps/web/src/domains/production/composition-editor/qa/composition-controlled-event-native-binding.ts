import {createHash} from "node:crypto";
import {z} from "zod";
import {compositionEditorDocumentSchema} from "../composition-document.types";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {prepareCompositionEventBatchContracts} from "../composition-conformance-event-batch-contract";
import {COMPOSITION_EVENT_PLAN_MAX_BATCHES} from "../composition-conformance-batch-contract";
import {controlledNativeEvidenceSchema} from "./composition-controlled-font-witness";
import {bindControlledRendererNativeEvidence} from "./composition-controlled-native-binding";
import {attachControlledOriginalSeekReport} from "./composition-controlled-seek-binding";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const eventNativeSchema = z.object({scope: z.literal("SDK_SESSION_PARTITION_NATIVE_NOT_PREVIEW_PARITY"),
  parentContractSha256: hash, planSha256: hash,
  batches: z.array(z.object({batchIndex: z.number().int().nonnegative(), contractSha256: hash,
    nativeEvidence: controlledNativeEvidenceSchema}).strict()).min(1).max(COMPOSITION_EVENT_PLAN_MAX_BATCHES),
}).strict();

/** Re-derive frozen child identities; a parent text witness never covers absent later checkpoints. */
export function bindControlledEventNativeEvidence(input: {
  document: unknown; parentContract: unknown; videoSha256: string; evidence: unknown;
}) {
  const document = compositionEditorDocumentSchema.parse(input.document);
  const parentContract = compositionConformanceContractSchema.parse(input.parentContract);
  const prepared = prepareCompositionEventBatchContracts({document, parentContract});
  const evidence = eventNativeSchema.parse(input.evidence);
  if (evidence.parentContractSha256 !== prepared.parentContractSha256 || evidence.planSha256 !== prepared.planSha256
    || evidence.batches.length !== prepared.batchCount) throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_COVERAGE_INVALID");
  const batches = evidence.batches.map((batch, index) => {
    const selected = prepared.select(index);
    if (batch.batchIndex !== index || batch.contractSha256 !== selected.batchContractSha256)
      throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_CONTRACT_INVALID");
    const bound = bindControlledRendererNativeEvidence(selected.contract, batch.nativeEvidence, input.videoSha256)!;
    return {...batch, nativeEvidence: bound.nativeEvidence};
  });
  return {...evidence, batches};
}

export function attachOriginalNativeEventComparison<T extends {document: unknown; parentContract: unknown;
  videoSha256: string; batches: Array<{contract: unknown; nativeEvidence?: unknown; seekRepeatability?: unknown}>}>(input: {
  expectedDocument: unknown; expectedContract: unknown; artifacts: {kind: "EVENT_BATCH_SET"; input: T};
  originalNative: {documentHash: string; video: {sha256: string}; eventNativeEvidence: unknown; eventSeekRepeatability?: unknown[]};
}) {
  const expected = compositionConformanceContractSchema.parse(input.expectedContract);
  const actual = compositionConformanceContractSchema.parse(input.artifacts.input.parentContract);
  const document = compositionEditorDocumentSchema.parse(input.expectedDocument);
  const artifactDocument = compositionEditorDocumentSchema.parse(input.artifacts.input.document);
  if (digest(expected) !== digest(actual) || digest(document) !== digest(artifactDocument)
    || input.originalNative.documentHash !== expected.documentHash
    || input.originalNative.video.sha256 !== input.artifacts.input.videoSha256)
    throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_COMPARISON_BINDING_INVALID");
  const bound = bindControlledEventNativeEvidence({document, parentContract: expected,
    videoSha256: input.originalNative.video.sha256, evidence: input.originalNative.eventNativeEvidence});
  if (input.artifacts.input.batches.length !== bound.batches.length)
    throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_COVERAGE_INVALID");
  if (expected.schemaVersion === 4 && expected.renderExecution?.seekRepeatabilityPolicy
    && input.originalNative.eventSeekRepeatability?.length !== bound.batches.length)
    throw new Error("CONTROLLED_RENDER_ORIGINAL_SEEK_REQUIRED");
  const batches = input.artifacts.input.batches.map((batch, index) => {
    const contract = compositionConformanceContractSchema.parse(batch.contract);
    const observed = bound.batches[index];
    if (digest(contract) !== observed.contractSha256) throw new Error("CONTROLLED_RENDER_EVENT_NATIVE_CONTRACT_INVALID");
    if (batch.nativeEvidence !== undefined) {
      const supplied = bindControlledRendererNativeEvidence(contract, batch.nativeEvidence, input.artifacts.input.videoSha256)!;
      if (digest(supplied.nativeEvidence) !== digest(observed.nativeEvidence))
        throw new Error("CONTROLLED_RENDER_ORIGINAL_NATIVE_COMPARISON_CONFLICT");
    }
    const seekRepeatability = attachControlledOriginalSeekReport(contract, input.originalNative.eventSeekRepeatability?.[index], batch.seekRepeatability);
    return {...batch, nativeEvidence: observed.nativeEvidence, ...(seekRepeatability ? {seekRepeatability} : {})};
  });
  return structuredClone({...input.artifacts, input: {...input.artifacts.input, batches}});
}
