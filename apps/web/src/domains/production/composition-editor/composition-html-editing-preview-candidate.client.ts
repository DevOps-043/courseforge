import {canonicalCompositionDocumentJson} from "./composition-document-canonical-json";
import {compositionEditorDocumentSchema, type CompositionEditorDocument} from "./composition-document.types";
import {simulateCompositionAgentOperations} from "./composition-agent-simulation.service";
import type {CompositionEditorPatchOperation} from "./editor-patch.types";
import {htmlPreviewCandidateSelectorSchema} from "./composition-html-editing-preview-candidate.contract";

export type HtmlPreviewCandidateRequest = {baseDocumentHash: string} & (
  {kind: "AGENT_PROPOSAL"; id: string; operations: CompositionEditorPatchOperation[]} |
  {kind: "PRESET_APPLICATION"; id: string; documentHash: string});
async function browserDocumentHash(document: CompositionEditorDocument) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalCompositionDocumentJson(document)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Navigation identity only. No permission, persistence, network or controller
 * policy; the issuer independently reads the stored candidate and current grants. */
export async function resolveHtmlPreviewCandidateIdentity(input: {
  document: CompositionEditorDocument; documentHash: string; candidate: HtmlPreviewCandidateRequest; signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const document = compositionEditorDocumentSchema.parse(input.document);
  if (!document.htmlEditing?.items.length) return null;
  const selected = htmlPreviewCandidateSelectorSchema.parse({kind: input.candidate.kind, id: input.candidate.id});
  if (input.candidate.baseDocumentHash !== input.documentHash || await browserDocumentHash(document) !== input.documentHash)
    throw new Error("HTML_PREVIEW_CANDIDATE_BASE_CHANGED");
  input.signal?.throwIfAborted();
  const candidateHash = input.candidate.kind === "AGENT_PROPOSAL"
    ? await browserDocumentHash(simulateCompositionAgentOperations(document, input.candidate.operations).document)
    : input.candidate.documentHash;
  input.signal?.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(candidateHash)) throw new Error("HTML_PREVIEW_CANDIDATE_INVALID");
  return {candidate: selected, documentHash: candidateHash};
}
