import { htmlEditingMutationRequestSchema, HTML_EDITING_MUTATION_HTTP_POLICY } from "./composition-html-editing-mutation.contract";

export const HTML_EDITING_OPERATION_DIGEST_PREFIX = "courseforge-html-editing-operation-request-v1\n";
/** Shared, deterministic preimage only; digest never confers authority. */
export function encodeHtmlEditingOperationRequest(input: unknown) {
  const request = htmlEditingMutationRequestSchema.parse(input), canonical = JSON.stringify(request);
  if (new TextEncoder().encode(canonical).byteLength > HTML_EDITING_MUTATION_HTTP_POLICY.maximumRequestBytes) {
    throw new Error("HTML_EDITING_OPERATION_REQUEST_TOO_LARGE");
  }
  return { request, canonical, preimage: HTML_EDITING_OPERATION_DIGEST_PREFIX + canonical };
}
