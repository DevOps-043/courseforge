import {createHash} from "node:crypto";
import {z} from "zod";
import {compositionEditorDocumentSchema} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
import {compositionConformanceContractSchema} from "../composition-preview-render-conformance";
import {assertDocumentConformanceFontBindings, buildDeclaredNativeFontUsageContract,
  conformanceFontManifestHash, conformanceFontManifestSchema} from "../composition-conformance-font-bindings";
import {captureBrowserVersionSchema} from "../composition-render-execution-contract";
import {readCaptureBrowserIdentity, assertCaptureBrowserIdentityUnchanged} from "./composition-browser-identity";
import {fontUsageEvidenceSchema, validateFontUsageCheckpointCoverage} from "./composition-font-usage-evidence";
import {startConformancePlatformFontCapture} from "./composition-platform-font-capture";
import {verifyConformanceFontLoading} from "./composition-font-loading-capture";
import {textCheckpointEvidenceSchema, validateTextParityEvidence,
  type TextParityEvidence} from "./composition-text-parity-evidence";
import type {CompositionQaCdpClient} from "./composition-qa-browser";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const controlledFontUsageEvidenceSchema = z.object({schemaVersion: z.literal(1),
  policy: z.literal("CONTROLLED_SESSION_CUSTOM_NATIVE_FONT_USAGE_V1"),
  scope: z.literal("LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION"), status: z.literal("CAPTURED"),
  documentHash: hash, contractSha256: hash, manifest: conformanceFontManifestSchema, manifestSha256: hash,
  browserBefore: captureBrowserVersionSchema, browserAfter: captureBrowserVersionSchema,
  bindings: fontUsageEvidenceSchema.shape.bindings, checkpoints: fontUsageEvidenceSchema.shape.checkpoints,
}).strict().superRefine((evidence, context) => {
  if (conformanceFontManifestHash(evidence.manifest) !== evidence.manifestSha256
    || new Set(evidence.bindings.map(binding => binding.elementId)).size !== evidence.bindings.length
    || new Set(evidence.checkpoints.map(point => point.frameIndex)).size !== evidence.checkpoints.length
    || evidence.checkpoints.reduce((count, point) => count + point.elements.length, 0) > 2048)
    context.addIssue({code: "custom", message: "CONTROLLED_RENDER_FONT_EVIDENCE_INVALID"});
});

/** Independently recheck a stored local witness; this still cannot promote renderer provenance to PASS. */
export function validateControlledFontUsageEvidence(input: unknown, contractInput: unknown, textInput: unknown) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  const evidence = controlledFontUsageEvidenceSchema.parse(input);
  if (contract.schemaVersion !== 4 || !contract.renderExecution || !contract.fontUsageContract?.bindings.length)
    throw new Error("CONTROLLED_RENDER_FONT_CONTRACT_REQUIRED");
  if (evidence.documentHash !== contract.documentHash || evidence.contractSha256 !== digest(contract)
    || evidence.manifestSha256 !== contract.fontUsageContract.manifestSha256
    || JSON.stringify(evidence.bindings) !== JSON.stringify(contract.fontUsageContract.bindings)
    || JSON.stringify(evidence.browserBefore) !== JSON.stringify(contract.renderExecution.expectedBrowser)
    || JSON.stringify(evidence.browserAfter) !== JSON.stringify(contract.renderExecution.expectedBrowser)
    || evidence.bindings.some(binding => !evidence.manifest.some(font => font.fontAssetId === binding.fontAssetId)))
    throw new Error("CONTROLLED_RENDER_FONT_EVIDENCE_BINDING_INVALID");
  const text = validateTextParityEvidence(textInput, contract, "RENDERER_GEOMETRY");
  validateFontUsageCheckpointCoverage(evidence, text);
  return evidence;
}

/** Start BEFORE navigation/font load on the owned capture session. Never relabel a preview witness. */
export async function startControlledFontCapture(input: {client: CompositionQaCdpClient; document: unknown;
  contract: unknown; fonts: unknown; origin: string; verifyFiles: () => Promise<void>; signal?: AbortSignal}) {
  assertConformanceJobActive(input.signal);
  const document = compositionEditorDocumentSchema.parse(input.document);
  const contract = compositionConformanceContractSchema.parse(input.contract);
  if (contract.schemaVersion !== 4 || !contract.renderExecution || !contract.fontUsageContract?.bindings.length
    || contract.documentHash !== hashCompositionDocument(document))
    throw new Error("CONTROLLED_RENDER_FONT_CONTRACT_REQUIRED");
  const fonts = assertDocumentConformanceFontBindings(document, input.fonts);
  const declared = buildDeclaredNativeFontUsageContract(document, fonts);
  if (JSON.stringify(declared) !== JSON.stringify(contract.fontUsageContract))
    throw new Error("CONTROLLED_RENDER_FONT_FROZEN_BINDING_MISMATCH");
  const verifyFilePins = input.verifyFiles;
  const verifyFiles = async () => {
    assertConformanceJobActive(input.signal);
    try {await verifyFilePins();} catch {
      assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_FONT_FILES_CHANGED");
    }
    assertConformanceJobActive(input.signal);
  };
  // The SDK owns this shared CDP session. Guard operations without closing somebody else's channel.
  const client: CompositionQaCdpClient = {close: () => input.client.close(),
    ...(input.client.onEvent ? {onEvent: (method: string, handler: (params: Record<string, unknown>) => void) =>
      input.client.onEvent!(method, handler)} : {}), async send(method, params) {
    // Release an already-acquired remote handle even after abort; session owner still closes CDP.
    if (method !== "Runtime.releaseObject") assertConformanceJobActive(input.signal);
    const result = await input.client.send(method, params);
    if (method !== "Runtime.releaseObject") assertConformanceJobActive(input.signal);
    return result;
  }};
  await verifyFiles();
  let before: Awaited<ReturnType<typeof readCaptureBrowserIdentity>>;
  try {before = await readCaptureBrowserIdentity(client);}
  catch {assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_FONT_BROWSER_UNAVAILABLE");}
  if (JSON.stringify(before.version) !== JSON.stringify(contract.renderExecution.expectedBrowser))
    throw new Error("CONTROLLED_RENDER_FONT_BROWSER_MISMATCH");
  let platform: Awaited<ReturnType<typeof startConformancePlatformFontCapture>>;
  try {platform = await startConformancePlatformFontCapture(client, fonts, document, input.origin);}
  catch {assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_FONT_SETUP_FAILED");}
  if (JSON.stringify(platform.bindings) !== JSON.stringify(declared.bindings)) {
    platform.close(); throw new Error("CONTROLLED_RENDER_FONT_OWNER_MISMATCH");
  }
  const checkpoints: TextParityEvidence["checkpoints"] = [];
  const glyphs: z.infer<typeof controlledFontUsageEvidenceSchema>["checkpoints"] = [];
  let closed = false, capturing = false, cleanupFailed = false;
  const onAbort = () => {try {close();} catch {/* Report cleanup failure through the owned close, not an uncaught event callback. */}};
  const close = () => {
    input.signal?.removeEventListener("abort", onAbort);
    if (!closed) {closed = true; try {platform.close();} catch {cleanupFailed = true;}}
    if (cleanupFailed) throw new Error("CONTROLLED_RENDER_FONT_CLEANUP_FAILED");
  };
  input.signal?.addEventListener("abort", onAbort, {once: true});
  if (input.signal?.aborted) {close(); assertConformanceJobActive(input.signal);}
  return {close, async capture(checkpointInput: unknown) {
    assertConformanceJobActive(input.signal);
    if (closed || capturing) throw new Error("CONTROLLED_RENDER_FONT_SESSION_INVALID");
    capturing = true;
    try {
      const checkpoint = textCheckpointEvidenceSchema.parse(checkpointInput);
      const expected = contract.textParity.checkpoints[checkpoints.length];
      if (!expected || checkpoint.frameIndex !== expected.frameIndex || checkpoint.timeSeconds !== expected.timeSeconds
        || checkpoint.status !== "CAPTURED" || JSON.stringify(checkpoint.expectedTexts) !== JSON.stringify(expected.expectedTexts))
        throw new Error("CONTROLLED_RENDER_FONT_CHECKPOINT_MISMATCH");
      await verifyFiles();
      await verifyConformanceFontLoading(client, fonts, false);
      const elements = await platform.verify(checkpoint);
      assertConformanceJobActive(input.signal);
      checkpoints.push(checkpoint); glyphs.push({frameIndex: checkpoint.frameIndex, timeSeconds: checkpoint.timeSeconds, elements});
    } catch {close(); assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_FONT_CAPTURE_FAILED");}
    finally {capturing = false;}
  }, async verifyRepeat(checkpointInput: unknown) {
    assertConformanceJobActive(input.signal);
    if (closed || capturing) throw new Error("CONTROLLED_RENDER_FONT_SESSION_INVALID");
    capturing = true;
    try {
      const checkpoint = textCheckpointEvidenceSchema.parse(checkpointInput);
      const index = checkpoints.findIndex(point => point.frameIndex === checkpoint.frameIndex);
      if (index < 0 || JSON.stringify(checkpoints[index]) !== JSON.stringify(checkpoint))
        throw new Error("CONTROLLED_RENDER_FONT_REPEAT_TEXT_MISMATCH");
      await verifyFiles(); await verifyConformanceFontLoading(client, fonts, false);
      const elements = await platform.verify(checkpoint);
      assertConformanceJobActive(input.signal);
      if (JSON.stringify(elements) !== JSON.stringify(glyphs[index].elements))
        throw new Error("CONTROLLED_RENDER_FONT_REPEAT_GLYPH_MISMATCH");
    } catch {close(); assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_FONT_REPEAT_FAILED");}
    finally {capturing = false;}
  }, async finish(textEvidenceInput: unknown) {
    assertConformanceJobActive(input.signal);
    if (closed || capturing || checkpoints.length !== contract.checkpoints.length)
      throw new Error("CONTROLLED_RENDER_FONT_COVERAGE_INCOMPLETE");
    capturing = true;
    try {
      await verifyFiles();
      await verifyConformanceFontLoading(client, fonts, false);
      const after = await readCaptureBrowserIdentity(client);
      assertCaptureBrowserIdentityUnchanged(before, after);
      // Seek evidence comes from the capture caller, not a fabricated repeatability label here.
      const text = validateTextParityEvidence(textEvidenceInput, contract, "RENDERER_GEOMETRY");
      if (JSON.stringify(text.checkpoints) !== JSON.stringify(checkpoints))
        throw new Error("CONTROLLED_RENDER_FONT_TEXT_WITNESS_MISMATCH");
      const evidence = controlledFontUsageEvidenceSchema.parse({schemaVersion: 1,
        policy: "CONTROLLED_SESSION_CUSTOM_NATIVE_FONT_USAGE_V1", scope: "LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION",
        status: "CAPTURED", documentHash: contract.documentHash, contractSha256: digest(contract), manifest: fonts,
        manifestSha256: declared.manifestSha256, browserBefore: before.version, browserAfter: after.version,
        bindings: declared.bindings, checkpoints: glyphs});
      assertConformanceJobActive(input.signal);
      return validateControlledFontUsageEvidence(evidence, contract, text);
    } catch {assertConformanceJobActive(input.signal); throw new Error("CONTROLLED_RENDER_FONT_FINALIZATION_FAILED");}
    finally {capturing = false; close();}
  }};
}
