import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_LEGACY_REVIEW_POLICY, htmlLegacyReviewCommandSchema, htmlLegacyReviewViewSchema,
  type HtmlLegacyReviewCommand } from "./composition-html-editing-legacy-review.contract";
import { HTML_LEGACY_ADOPTION_HTTP_POLICY } from "./composition-html-editing-legacy-adoption-http-policy";

const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: htmlLegacyReviewViewSchema }).strict();
/** One bounded read. Source is display-only text; never execute it as preview. */
export async function consultHtmlLegacyReview(input: { command: HtmlLegacyReviewCommand; signal: AbortSignal; fetcher?: typeof fetch }) {
  try {
    const command = htmlLegacyReviewCommandSchema.parse(input.command);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_LEGACY_ADOPTION_HTTP_POLICY.timeoutMs)]); signal.throwIfAborted();
    const url = `/api/production/hyperframes/drafts/${command.documentId}/html-editing/${command.clipId}/adopt/candidates/${command.candidateId}?${new URLSearchParams({ expectedDocumentHash: command.expectedDocumentHash })}`;
    const response = await (input.fetcher ?? fetch)(url, { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    if (response.status !== 200) throw new Error();
    const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, HTML_LEGACY_REVIEW_POLICY.responseBytes + HTML_LEGACY_REVIEW_POLICY.envelopeBytes, signal));
    const view = envelope.data;
    if (envelope.requestId !== envelope.correlationId || view.actorId !== command.actorId || view.organizationId !== command.organizationId
      || view.documentId !== command.documentId || view.clipId !== command.clipId || view.request.candidateId !== command.candidateId
      || view.request.expectedDocumentHash !== command.expectedDocumentHash) throw new Error();
    const digest = async (source: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (await digest(view.originalSource) !== view.originalSourceSha256 || await digest(view.candidateSource) !== view.candidateSourceSha256) throw new Error();
    signal.throwIfAborted(); return view;
  } catch { throw new Error("HTML_LEGACY_REVIEW_UNAVAILABLE"); }
}
