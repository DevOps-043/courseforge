import { createHash } from "node:crypto";
import { encodeHtmlEditingInitializationOperationRequest } from "./composition-html-editing-initialization-operation-request";

export function computeHtmlEditingInitializationRequestSha256(input: unknown) {
  return createHash("sha256").update(encodeHtmlEditingInitializationOperationRequest(input).preimage, "utf8").digest("hex");
}
