import { createHash } from "node:crypto";
import { GOOGLE_FONT_BUNDLE_FORMAT, googleFontBundleManifestSchema, type GoogleFontBundleManifest } from "./google-font-bundle.contract";
import type { prepareGoogleFontBytes } from "./google-font-preparation.server";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";

export function normalizeGoogleFontBundleManifest(input: unknown): GoogleFontBundleManifest {
  const manifest = googleFontBundleManifestSchema.parse(input);
  return { ...manifest,
    files: manifest.files.sort((first, second) => lexicalOrder(first.checksumSha256, second.checksumSha256)),
    faces: manifest.faces.sort((first, second) => lexicalOrder(JSON.stringify(first), JSON.stringify(second))),
  };
}
export function googleFontBundleIdentity(input: unknown) {
  const manifest = normalizeGoogleFontBundleManifest(input), manifestText = JSON.stringify(manifest);
  if (Buffer.byteLength(manifestText) > GOOGLE_FONT_PREPARATION_POLICY.manifestBytes) throw new Error("GOOGLE_FONT_BUNDLE_MANIFEST_LIMIT");
  return { manifest, manifestText, candidateSha256: createHash("sha256").update(manifestText).digest("hex") };
}
export function googleFontCandidateBundle(candidate: Awaited<ReturnType<typeof prepareGoogleFontBytes>>) {
  const files = new Map<string, GoogleFontBundleManifest["files"][number]>();
  for (const font of candidate.files) {
    const entry = { checksumSha256: font.checksumSha256, fileSizeBytes: font.fileSizeBytes, mimeType: font.mimeType, embeddingCheck: font.embeddingCheck };
    const previous = files.get(entry.checksumSha256);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error("GOOGLE_FONT_BUNDLE_FILE_CONFLICT");
    files.set(entry.checksumSha256, entry);
  }
  return googleFontBundleIdentity({ format: GOOGLE_FONT_BUNDLE_FORMAT, source: candidate.source, family: candidate.family,
    stylesheetChecksumSha256: candidate.stylesheetChecksumSha256, files: [...files.values()], faces: candidate.faces });
}
function lexicalOrder(first: string, second: string) { return first < second ? -1 : first > second ? 1 : 0; }
