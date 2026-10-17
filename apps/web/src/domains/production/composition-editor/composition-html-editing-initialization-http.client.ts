import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope } from "./composition-html-snapshot-locator.client";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { htmlEditingInitializationRequestSchema, htmlEditingInitializationAcknowledgmentSchema,
  HTML_EDITING_INITIALIZATION_HTTP_POLICY as policy, type HtmlEditingInitializationRequest } from "./composition-html-editing-initialization-http.contract";

export class HtmlEditingInitializationClientError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "INVALID_REQUEST" | "OUTCOME_UNKNOWN") {
    super(`HTML_EDITING_INITIALIZATION_${code}`); this.name = "HtmlEditingInitializationClientError";
  }
}
const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlEditingInitializationAcknowledgmentSchema }).strict();

/** Single POST only. The coordinated host must durably track intent before calling.
 * A lost/invalid response remains unknown; a later inspector GET is not its ACK.
 * Local owner scope is correlation only, never authority supplied in the body. */
export async function sendHtmlEditingInitialization(input: { scope: HtmlSnapshotLocatorScope; clipId: string;
  body: HtmlEditingInitializationRequest; signal?: AbortSignal; fetcher?: typeof fetch }) {
  const scope = htmlSnapshotLocatorScopeSchema.safeParse(input.scope), clip = htmlEditingBindingSchema.shape.clipId.safeParse(input.clipId);
  const body = htmlEditingInitializationRequestSchema.safeParse(input.body);
  if (!scope.success || !clip.success || !body.success || input.signal?.aborted) throw new HtmlEditingInitializationClientError("INVALID_REQUEST");
  const encoded = JSON.stringify(body.data);
  const endpoint = `/api/production/hyperframes/drafts/${scope.data.draftId}/html-editing/${clip.data}/initialize`;
  if (new TextEncoder().encode(encoded).byteLength > policy.maximumRequestBytes
    || new TextEncoder().encode(endpoint).byteLength > policy.maximumUrlBytes) throw new HtmlEditingInitializationClientError("INVALID_REQUEST");
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]) : AbortSignal.timeout(policy.timeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(endpoint, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json" }, body: encoded, signal });
    const result = envelopeSchema.parse(await readBoundedCompositionJson(response, policy.maximumResponseBytes, signal));
    signal.throwIfAborted();
    if (result.requestId !== result.correlationId || result.data.compositionDocumentHash !== body.data.expectedDocumentHash
      || (response.status !== 200 && response.status !== 201) || (response.status === 201) !== result.data.created) throw new Error();
    return result.data;
  } catch { throw new HtmlEditingInitializationClientError("OUTCOME_UNKNOWN"); }
}
