import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingOperationIdentitySchema } from "./html-editing/html-editing-operation.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope } from "./composition-html-snapshot-locator.client";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_EDITING_INITIALIZATION_HTTP_POLICY } from "./composition-html-editing-initialization-http.contract";
import { HTML_EDITING_INITIALIZATION_OPERATION_POLICY, htmlEditingInitializationOperationReadSchema } from "./composition-html-editing-initialization-operation.contract";
import { HTML_EDITING_INITIALIZATION_OPERATION_HTTP_POLICY } from "./composition-html-editing-initialization-operation-http-policy";
import { encodeHtmlEditingInitializationOperationRequest } from "./composition-html-editing-initialization-operation-request";

const responseOverheadBytes = 1024;
const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlEditingInitializationOperationReadSchema }).strict();
type Locator = { scope: HtmlSnapshotLocatorScope; clipId: string; operationId: string; requestSha256: string };
type Transport = { signal?: AbortSignal; fetcher?: typeof fetch };

export class HtmlEditingInitializationOperationClientError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "INVALID_REQUEST" | "READ_UNAVAILABLE" | "OUTCOME_UNKNOWN") {
    super(`HTML_INITIALIZATION_OPERATION_${code}`);
    this.name = "HtmlEditingInitializationOperationClientError";
  }
}

export async function computeHtmlEditingInitializationRequestSha256InBrowser(input: unknown) {
  const encoded = encodeHtmlEditingInitializationOperationRequest(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded.preimage));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validateLocator(input: Locator): Locator {
  return { scope: htmlSnapshotLocatorScopeSchema.parse(input.scope), clipId: htmlEditingBindingSchema.shape.clipId.parse(input.clipId),
    ...htmlEditingOperationIdentitySchema.parse({ operationId: input.operationId, requestSha256: input.requestSha256 }) };
}
function endpoint(locator: Locator) {
  return `/api/production/hyperframes/drafts/${locator.scope.draftId}/html-editing/${locator.clipId}/initialize/operations/${locator.operationId}`;
}
function validateUrl(url: string) {
  if (new TextEncoder().encode(url).byteLength > HTML_EDITING_INITIALIZATION_OPERATION_HTTP_POLICY.maximumUrlBytes) throw new Error();
  return url;
}
function deadline(input: Transport, timeoutMs: number) {
  return input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}
async function decode(response: Response, locator: Locator, signal: AbortSignal) {
  if (response.status !== 200) throw new Error();
  const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response,
    HTML_EDITING_INITIALIZATION_OPERATION_POLICY.maximumReceiptBytes + responseOverheadBytes, signal));
  signal.throwIfAborted();
  if (envelope.requestId !== envelope.correlationId) throw new Error();
  if (envelope.data.status === "RECORDED") {
    const receipt = envelope.data.receipt;
    if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > HTML_EDITING_INITIALIZATION_OPERATION_POLICY.maximumReceiptBytes
      || receipt.owner.actorId !== locator.scope.actorId || receipt.owner.organizationId !== locator.scope.organizationId
      || receipt.owner.draftId !== locator.scope.draftId || receipt.clipId !== locator.clipId
      || receipt.operationId !== locator.operationId || receipt.requestSha256 !== locator.requestSha256
      || await computeHtmlEditingInitializationRequestSha256InBrowser(receipt.request) !== locator.requestSha256) throw new Error();
  }
  signal.throwIfAborted();
  return envelope.data;
}

/** Exactly one POST. Caller must persist the operation identity before dispatch.
 * Historical created=true receipts still use HTTP 200; no legacy fallback. */
export async function sendHtmlEditingInitializationOperation(input: Locator & Transport & { body: unknown }) {
  let locator: Locator, encoded: ReturnType<typeof encodeHtmlEditingInitializationOperationRequest>, url: string;
  try {
    input.signal?.throwIfAborted();
    locator = validateLocator(input);
    encoded = encodeHtmlEditingInitializationOperationRequest(input.body);
    url = validateUrl(endpoint(locator));
    if (await computeHtmlEditingInitializationRequestSha256InBrowser(encoded.request) !== locator.requestSha256) throw new Error();
    input.signal?.throwIfAborted();
  } catch { throw new HtmlEditingInitializationOperationClientError("INVALID_REQUEST"); }
  const signal = deadline(input, HTML_EDITING_INITIALIZATION_HTTP_POLICY.timeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(url, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: { "content-type": "application/json" }, body: encoded.canonical, signal });
    const result = await decode(response, locator, signal);
    if (result.status !== "RECORDED" || JSON.stringify(result.receipt.request) !== encoded.canonical) throw new Error();
    return result.receipt;
  } catch { throw new HtmlEditingInitializationOperationClientError("OUTCOME_UNKNOWN"); }
}

/** Authorized metadata only. NOT_FOUND cannot justify a POST or clearing intent. */
export async function consultHtmlEditingInitializationOperation(input: Locator & Transport) {
  let locator: Locator, url: string;
  try {
    input.signal?.throwIfAborted();
    locator = validateLocator(input);
    url = validateUrl(`${endpoint(locator)}?requestSha256=${locator.requestSha256}`);
  } catch { throw new HtmlEditingInitializationOperationClientError("INVALID_REQUEST"); }
  const signal = deadline(input, HTML_EDITING_INITIALIZATION_OPERATION_HTTP_POLICY.readTimeoutMs);
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(url, { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    return await decode(response, locator, signal);
  } catch { throw new HtmlEditingInitializationOperationClientError("READ_UNAVAILABLE"); }
}
