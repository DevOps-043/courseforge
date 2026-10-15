import { createHash } from "node:crypto";
import { encodeHtmlEditingOperationRequest } from "./composition-html-editing-operation-request";

/** Server-derived semantic digest. Includes action, CAS and ordered overrides;
 * excludes operation ID, actor, tenant, request formatting and unknown fields.
 * A receipt remains separately scoped to the authenticated owner/draft/clip. */
export function computeHtmlEditingOperationRequestSha256(input: unknown): string {
  return createHash("sha256").update(encodeHtmlEditingOperationRequest(input).preimage, "utf8").digest("hex");
}
