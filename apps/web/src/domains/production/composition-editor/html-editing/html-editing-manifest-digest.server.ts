import { createHash } from "node:crypto";
import type { HtmlEditableManifest, HtmlEditingBinding, HtmlEditingCommand } from "./html-editing.contract";
import { HtmlEditingValidationError, parseHtmlEditableManifest, validateHtmlEditingCommand } from "./html-editing-validation";
import { canonicalHtmlEditingJson } from "./html-editing-canonical-json.server";

/** SHA-256 domain separator; changing the encoding requires a new digest version.
 * This is our bounded V1 encoding, not a claim of RFC 8785/JCS compliance. */
export const HTML_EDITABLE_MANIFEST_DIGEST_PREFIX = "courseforge-html-editable-manifest-digest-v1\n";

function manifestPreimage(manifest: HtmlEditableManifest): string {
  // Only this one self-referential slot is omitted. Source/document hashes and
  // every authorization-scoping identity remain covered by the content digest.
  const { manifestSha256: _selfDigest, ...binding } = manifest.binding;
  return HTML_EDITABLE_MANIFEST_DIGEST_PREFIX + canonicalHtmlEditingJson({
    format: manifest.format, binding, elements: manifest.elements,
  });
}

/** Bounded JSON/schema validation occurs before canonicalization. Issuers may
 * use a valid placeholder hash in both bindings when initially computing it. */
export function createHtmlEditableManifestDigestPreimage(
  encodedManifest: string, expectedBinding: HtmlEditingBinding,
): string {
  return manifestPreimage(parseHtmlEditableManifest(encodedManifest, expectedBinding));
}

export function computeHtmlEditableManifestSha256(
  encodedManifest: string, expectedBinding: HtmlEditingBinding,
): string {
  return createHash("sha256").update(createHtmlEditableManifestDigestPreimage(encodedManifest, expectedBinding), "utf8").digest("hex");
}

/** Content integrity only. The expected digest must be fetched independently
 * from authoritative storage, not copied from the request's claimed binding. */
export function verifyHtmlEditableManifestContent(
  encodedManifest: string, authoritativeBinding: HtmlEditingBinding,
): HtmlEditableManifest {
  const manifest = parseHtmlEditableManifest(encodedManifest, authoritativeBinding);
  const observedSha256 = createHash("sha256").update(manifestPreimage(manifest), "utf8").digest("hex");
  if (observedSha256 !== authoritativeBinding.manifestSha256) {
    throw new HtmlEditingValidationError("MANIFEST_DIGEST_MISMATCH");
  }
  return manifest;
}

/** Verifies the manifest anew before command preflight, preventing callers from
 * treating a previously checked but subsequently mutated object as verified. */
export function validateContentVerifiedHtmlEditingCommand(params: {
  encodedManifest: string; encodedCommand: string;
  authoritativeBinding: HtmlEditingBinding; grantedAssetIds: readonly string[];
}): HtmlEditingCommand {
  const manifest = verifyHtmlEditableManifestContent(params.encodedManifest, params.authoritativeBinding);
  return validateHtmlEditingCommand({
    encodedCommand: params.encodedCommand, manifest,
    verifiedBinding: params.authoritativeBinding, grantedAssetIds: params.grantedAssetIds,
  });
}
