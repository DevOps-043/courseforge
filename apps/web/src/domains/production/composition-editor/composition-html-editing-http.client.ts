import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingInspectorViewSchema, HTML_EDITING_INSPECTOR_POLICY } from "./html-editing/html-editing-inspector.contract";
import { htmlEditingMutationRequestSchema, htmlEditingMutationAcknowledgmentSchema, HTML_EDITING_MUTATION_HTTP_POLICY,
  type HtmlEditingMutationRequest } from "./composition-html-editing-mutation.contract";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_EDITING_INSPECTOR_HTTP_POLICY } from "./composition-html-editing-inspector-http-policy";

const clientPolicy = Object.freeze({ envelopeOverheadBytes: 1024, mutationResponseBytes: 4096 });

const scopeSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true });
export type HtmlEditingClientScope = z.infer<typeof scopeSchema>;
const envelope = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid() }).strict();
export class HtmlEditingClientError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "READ_UNAVAILABLE" | "OUTCOME_UNKNOWN") {
    super(`HTML_EDITING_${code}`); this.name = "HtmlEditingClientError";
  }
}
function endpoint(scope: HtmlEditingClientScope) {
  return `/api/production/hyperframes/drafts/${scope.documentId}/html-editing/${scope.clipId}`;
}
export async function consultHtmlEditingInspector(input: { scope: HtmlEditingClientScope; signal?: AbortSignal; fetcher?: typeof fetch }) {
  const parsed = scopeSchema.safeParse(input.scope);
  if (!parsed.success) throw new HtmlEditingClientError("INVALID_REQUEST");
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_INSPECTOR_HTTP_POLICY.timeoutMs)])
    : AbortSignal.timeout(HTML_EDITING_INSPECTOR_HTTP_POLICY.timeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(endpoint(parsed.data), { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    const result = envelope.extend({ data: htmlEditingInspectorViewSchema }).parse(await readBoundedCompositionJson(
      response, HTML_EDITING_INSPECTOR_POLICY.responseBytes + clientPolicy.envelopeOverheadBytes, signal));
    const binding = result.data.manifest.binding;
    if (result.requestId !== result.correlationId || binding.organizationId !== parsed.data.organizationId
      || binding.documentId !== parsed.data.documentId || binding.clipId !== parsed.data.clipId) throw new Error();
    return result.data;
  } catch { throw new HtmlEditingClientError("READ_UNAVAILABLE"); }
}
/** One dispatch only. Caller must coordinate save queue/ownership and remember
 * uncertain writes before invoking; abort cannot roll back a server commit. */
export async function sendHtmlEditingMutation(input: { scope: HtmlEditingClientScope; body: HtmlEditingMutationRequest;
  signal?: AbortSignal; fetcher?: typeof fetch }) {
  const scope = scopeSchema.safeParse(input.scope), body = htmlEditingMutationRequestSchema.safeParse(input.body);
  if (!scope.success || !body.success) throw new HtmlEditingClientError("INVALID_REQUEST");
  const encoded = JSON.stringify(body.data);
  if (new TextEncoder().encode(encoded).byteLength > HTML_EDITING_MUTATION_HTTP_POLICY.maximumRequestBytes) throw new HtmlEditingClientError("INVALID_REQUEST");
  if (input.signal?.aborted) throw new HtmlEditingClientError("INVALID_REQUEST");
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_MUTATION_HTTP_POLICY.timeoutMs)])
    : AbortSignal.timeout(HTML_EDITING_MUTATION_HTTP_POLICY.timeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(endpoint(scope.data), { method: "POST", credentials: "same-origin", redirect: "error",
      cache: "no-store", headers: { "content-type": "application/json" }, body: encoded, signal });
    const result = envelope.extend({ data: htmlEditingMutationAcknowledgmentSchema }).parse(await readBoundedCompositionJson(response, clientPolicy.mutationResponseBytes, signal));
    if (result.requestId !== result.correlationId || result.data.previous.version !== body.data.expected.version
      || result.data.previous.sha256 !== body.data.expected.sha256) throw new Error();
    return result.data;
  } catch { throw new HtmlEditingClientError("OUTCOME_UNKNOWN"); }
}
