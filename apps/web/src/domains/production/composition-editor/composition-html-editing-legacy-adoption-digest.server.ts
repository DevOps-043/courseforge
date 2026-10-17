import { createHash } from "node:crypto";
import { encodeHtmlLegacyAdoptionCommand } from "./composition-html-editing-legacy-adoption-request";

/** The full owner, clip and operation identity are bound, not merely the candidate. */
export function computeHtmlLegacyAdoptionRequestSha256(input: unknown) {
  return createHash("sha256").update(encodeHtmlLegacyAdoptionCommand(input).preimage, "utf8").digest("hex");
}
