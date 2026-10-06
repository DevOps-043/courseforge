import { htmlEditingInitializationRequestSchema, HTML_EDITING_INITIALIZATION_HTTP_POLICY } from "./composition-html-editing-initialization-http.contract";

export const HTML_EDITING_INITIALIZATION_DIGEST_PREFIX = "courseforge-html-initialization-request-v1\n";
/** Shared canonical preimage. Neither request digest nor template locator grants authority. */
export function encodeHtmlEditingInitializationOperationRequest(input: unknown) {
  const request = htmlEditingInitializationRequestSchema.parse(input), canonical = JSON.stringify(request);
  if (new TextEncoder().encode(canonical).byteLength > HTML_EDITING_INITIALIZATION_HTTP_POLICY.maximumRequestBytes) {
    throw new Error("HTML_INITIALIZATION_REQUEST_TOO_LARGE");
  }
  return { request, canonical, preimage: HTML_EDITING_INITIALIZATION_DIGEST_PREFIX + canonical };
}
