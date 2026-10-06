import { z } from "zod";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocumentInBrowser } from "./composition-recovery-journal";
import { htmlEditingInspectorViewSchema } from "./html-editing/html-editing-inspector.contract";
import { HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT } from "./html-editing/html-editing-reference.contract";
import { htmlEditingBindingsMatch } from "./html-editing/html-editing-validation";
import { htmlEditingMutationAcknowledgmentSchema } from "./composition-html-editing-mutation.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope } from "./composition-html-snapshot-locator.client";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { consultHtmlEditingInspector } from "./composition-html-editing-http.client";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";

export const HTML_EDITING_REBASE_POLICY = Object.freeze({ responseBytes: 16 * 1024 * 1024, timeoutMs: 20_000 });
const payloadSchema = z.object({ document: compositionEditorDocumentSchema, documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export type HtmlEditingNativePayload = z.infer<typeof payloadSchema>;
const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: payloadSchema }).strict();

/** Authorized read only; caller still verifies identity and adoption policy. */
export async function readHtmlEditingNativePayload(scopeInput: HtmlSnapshotLocatorScope, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const scope = htmlSnapshotLocatorScopeSchema.parse(scopeInput);
  signal.throwIfAborted();
  const response = await fetcher(`/api/production/hyperframes/drafts/${scope.draftId}/document`,
    { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
  const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, HTML_EDITING_REBASE_POLICY.responseBytes, signal));
  if (envelope.requestId !== envelope.correlationId) throw new Error("HTML_EDITING_READ_UNCORRELATED");
  return envelope.data;
}

/** Integrity/identity check, not authorization or render certification. A caller
 * must still fence native edits and recheck current owner/base/signal immediately
 * before adopting the returned payload; this function never mutates UI state. */
export async function verifyHtmlEditingRebase(input: {
  scope: HtmlSnapshotLocatorScope; clipId: string; base: unknown; candidate: unknown;
  beforeView: unknown; afterView: unknown; acknowledgment: unknown; signal: AbortSignal;
}): Promise<HtmlEditingNativePayload> {
  try {
    input.signal.throwIfAborted();
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), clipId = htmlEditingBindingSchema.shape.clipId.parse(input.clipId);
    const base = payloadSchema.parse(input.base), candidate = payloadSchema.parse(input.candidate);
    const before = htmlEditingInspectorViewSchema.parse(input.beforeView), after = htmlEditingInspectorViewSchema.parse(input.afterView);
    const ack = htmlEditingMutationAcknowledgmentSchema.parse(input.acknowledgment);
    const binding = before.manifest.binding;
    if (binding.organizationId !== scope.organizationId || binding.documentId !== scope.draftId || binding.clipId !== clipId
      || !htmlEditingBindingsMatch(binding, after.manifest.binding) || JSON.stringify(before.manifest) !== JSON.stringify(after.manifest)
      || before.compositionDocumentHash !== base.documentHash || after.compositionDocumentHash !== candidate.documentHash
      || before.revisionVersion !== ack.previous.version || before.revisionSha256 !== ack.previous.sha256
      || after.revisionVersion !== ack.next.version || after.revisionSha256 !== ack.next.sha256
      || candidate.version !== base.version + (ack.changed ? 1 : 0)) throw new Error();
    const clip = base.document.clips.find(value => value.id === clipId);
    if (!clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE") throw new Error();
    const sourceDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clip.source.html));
    const sourceSha256 = [...new Uint8Array(sourceDigest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (sourceSha256 !== binding.sourceSha256 || await hashCompositionDocumentInBrowser(base.document) !== base.documentHash) throw new Error();
    const previous = base.document.htmlEditing?.items.find(value => value.clipId === clipId);
    const reference = { clipId, revisionVersion: ack.next.version, revisionSha256: ack.next.sha256,
      templateId: binding.templateId, templateVersion: binding.templateVersion, sourceSha256: binding.sourceSha256, manifestSha256: binding.manifestSha256 };
    if (previous ? JSON.stringify(previous) !== JSON.stringify({ ...reference, revisionVersion: ack.previous.version, revisionSha256: ack.previous.sha256 })
      : ack.previous.version !== 1) throw new Error();
    const expectedDocument = ack.changed ? compositionEditorDocumentSchema.parse({ ...base.document,
      format: HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT,
      htmlEditing: { format: "courseforge-html-editable-references-v1", items: [
        ...(base.document.htmlEditing?.items ?? []).filter(value => value.clipId !== clipId), reference,
      ].sort((left, right) => left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0) },
    }) : base.document;
    if (await hashCompositionDocumentInBrowser(candidate.document) !== candidate.documentHash
      || await hashCompositionDocumentInBrowser(expectedDocument) !== candidate.documentHash) throw new Error();
    input.signal.throwIfAborted();
    return candidate;
  } catch { throw new Error("HTML_EDITING_REBASE_UNVERIFIED"); }
}

/** Two bounded explicit authorized reads. A newer unrelated write between reads
 * is a conflict, not permission to merge or overwrite local edits. No retry. */
export async function readHtmlEditingRebaseCandidate(input: {
  scope: HtmlSnapshotLocatorScope; clipId: string; base: unknown; beforeView: unknown; acknowledgment: unknown;
  signal?: AbortSignal; fetcher?: typeof fetch;
}) {
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), clipId = htmlEditingBindingSchema.shape.clipId.parse(input.clipId);
    const base = payloadSchema.parse(input.base), beforeView = htmlEditingInspectorViewSchema.parse(input.beforeView);
    const acknowledgment = htmlEditingMutationAcknowledgmentSchema.parse(input.acknowledgment);
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REBASE_POLICY.timeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_REBASE_POLICY.timeoutMs);
    signal.throwIfAborted();
    const candidate = await readHtmlEditingNativePayload(scope, signal, input.fetcher);
    const afterView = await consultHtmlEditingInspector({ scope: { organizationId: scope.organizationId, documentId: scope.draftId, clipId }, signal, fetcher: input.fetcher });
    const payload = await verifyHtmlEditingRebase({ scope, clipId, base, candidate, beforeView, afterView, acknowledgment, signal });
    return { payload, view: afterView };
  } catch { throw new Error("HTML_EDITING_REBASE_UNVERIFIED"); }
}
