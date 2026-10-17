import { z } from "zod";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope } from "./composition-html-snapshot-locator.client";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { HTML_EDITING_OPERATION_POLICY, htmlEditingOperationIdentitySchema, htmlEditingOperationReadSchema } from "./composition-html-editing-operation.contract";
import { HTML_EDITING_OPERATION_HTTP_POLICY } from "./composition-html-editing-operation-http-policy";
import { encodeHtmlEditingOperationRequest } from "./composition-html-editing-operation-request";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";

const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: htmlEditingOperationReadSchema }).strict();
const responseOverheadBytes = 1024;
type Locator = { scope: HtmlSnapshotLocatorScope; clipId: string; operationId: string; requestSha256: string };
export class HtmlEditingOperationClientError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "INVALID_REQUEST" | "READ_UNAVAILABLE" | "OUTCOME_UNKNOWN") {
    super(`HTML_EDITING_OPERATION_${code}`); this.name = "HtmlEditingOperationClientError";
  }
}
export async function computeHtmlEditingOperationRequestSha256InBrowser(input: unknown) {
  const encoded = encodeHtmlEditingOperationRequest(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded.preimage));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function validateLocator(input: Locator) {
  return { scope: htmlSnapshotLocatorScopeSchema.parse(input.scope), clipId: htmlEditingBindingSchema.shape.clipId.parse(input.clipId),
    ...htmlEditingOperationIdentitySchema.parse({ operationId: input.operationId, requestSha256: input.requestSha256 }) };
}
function endpoint(input: Locator) {
  return `/api/production/hyperframes/drafts/${input.scope.draftId}/html-editing/${input.clipId}/operations/${input.operationId}`;
}
async function decode(response: Response, locator: Locator, signal: AbortSignal) {
  const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, HTML_EDITING_OPERATION_POLICY.maximumReceiptBytes + responseOverheadBytes, signal));
  if (envelope.requestId !== envelope.correlationId) throw new Error();
  if (envelope.data.status === "RECORDED") {
    const receipt = envelope.data.receipt;
    if (receipt.owner.actorId !== locator.scope.actorId || receipt.owner.organizationId !== locator.scope.organizationId
      || receipt.owner.draftId !== locator.scope.draftId || receipt.clipId !== locator.clipId
      || receipt.operationId !== locator.operationId || receipt.requestSha256 !== locator.requestSha256) throw new Error();
  }
  return envelope.data;
}
/** One POST; coordinator must persist identity and reserve/lock before calling. */
export async function sendHtmlEditingOperation(input: Locator & { body: unknown; signal?: AbortSignal; fetcher?: typeof fetch }) {
  let locator: Locator, encoded: ReturnType<typeof encodeHtmlEditingOperationRequest>;
  try {
    locator = validateLocator(input); encoded = encodeHtmlEditingOperationRequest(input.body);
    input.signal?.throwIfAborted();
    if (await computeHtmlEditingOperationRequestSha256InBrowser(encoded.request) !== locator.requestSha256) throw new Error();
    input.signal?.throwIfAborted();
  } catch { throw new HtmlEditingOperationClientError("INVALID_REQUEST"); }
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_OPERATION_HTTP_POLICY.timeoutMs)])
    : AbortSignal.timeout(HTML_EDITING_OPERATION_HTTP_POLICY.timeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(endpoint(locator), { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json" }, body: encoded.canonical, signal });
    const result = await decode(response, locator, signal);
    if (result.status !== "RECORDED" || result.receipt.acknowledgment.previous.version !== encoded.request.expected.version
      || result.receipt.acknowledgment.previous.sha256 !== encoded.request.expected.sha256) throw new Error();
    return result.receipt;
  } catch { throw new HtmlEditingOperationClientError("OUTCOME_UNKNOWN"); }
}
/** Explicit metadata GET, no automatic poll/retry/closure. Absence stays unknown. */
export async function consultHtmlEditingOperation(input: Locator & { signal?: AbortSignal; fetcher?: typeof fetch }) {
  let locator: Locator;
  try { locator = validateLocator(input); input.signal?.throwIfAborted(); }
  catch { throw new HtmlEditingOperationClientError("INVALID_REQUEST"); }
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_OPERATION_HTTP_POLICY.readTimeoutMs)])
    : AbortSignal.timeout(HTML_EDITING_OPERATION_HTTP_POLICY.readTimeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(`${endpoint(locator)}?requestSha256=${locator.requestSha256}`,
      { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    return await decode(response, locator, signal);
  } catch { throw new HtmlEditingOperationClientError("READ_UNAVAILABLE"); }
}
