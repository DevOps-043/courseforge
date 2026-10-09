import { htmlLegacyAdoptionCommandSchema } from "./composition-html-editing-legacy-adoption.contract";
import { HTML_LEGACY_ADOPTION_HTTP_POLICY } from "./composition-html-editing-legacy-adoption-http-policy";

/** One preimage shared by server and browser; preserves digest v1 byte-for-byte. */
export function encodeHtmlLegacyAdoptionCommand(input: unknown) {
  const command = htmlLegacyAdoptionCommandSchema.parse(input);
  const canonical = JSON.stringify(command.request);
  if (new TextEncoder().encode(canonical).byteLength > HTML_LEGACY_ADOPTION_HTTP_POLICY.maximumRequestBytes)
    throw new Error("HTML_LEGACY_ADOPTION_REQUEST_LIMIT");
  const preimage = JSON.stringify(["courseforge-html-legacy-adoption-command-v1",
    command.organizationId, command.documentId, command.clipId, command.actorId, command.operationId,
    command.request.candidateId, command.request.provenanceSha256, command.request.expectedDocumentHash]);
  return { command, canonical, preimage };
}
