import { createHash } from "node:crypto";
import { z } from "zod";
import { GOOGLE_FONT_ADMISSION_FORMAT, googleFontAdmissionReceiptSchema } from "./google-font-admission.contract";
import { googleFontBundleIdentity } from "./google-font-bundle-identity.server";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";
import { registeredGoogleFontSchema } from "./google-font-preparation-query.server";
import { assertGoogleFontFaceMetadata, decodeGoogleFont, googleFontUnicodeIntervals } from "./google-font-decoding.server";
import { GoogleFontBundleCommitError, type GoogleFontBundleStore } from "./google-font-bundle-store.server";
import type { GoogleFontBundleManifest } from "./google-font-bundle.contract";

export type GoogleFontAdmissionRepository = Pick<GoogleFontBundleStore, "readFont" | "readBundle"> & {
  commitAdmission(input: { organizationId: string; actorId: string; fontId: string; bundleId: string;
    candidateSha256: string; proofText: string; signal: AbortSignal }): Promise<unknown>;
};
export type GoogleFontAdmissionStorage = {
  readFile(input: { organizationId: string; candidateSha256: string; file: GoogleFontBundleManifest["files"][number]; signal: AbortSignal }): Promise<Uint8Array>;
};
const storedBundle = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), font_id: z.string().uuid(),
  candidate_sha256: z.string().regex(/^[a-f0-9]{64}$/), manifest_text: z.string().max(GOOGLE_FONT_PREPARATION_POLICY.manifestBytes),
  registration_css_url: z.string().max(2000), status: z.enum(["PREPARED", "REVOKED"]),
}).strict();

/** A separate, explicit server use case. PREPARED never grants native access.
 * Every file is read back and decoded before submitting an immutable proof;
 * SQL must still reauthorize/lock current registry, bundle and object metadata. */
export async function admitPreparedGoogleFont(input: {
  organizationId: string; actorId: string; fontId: string; expectedCandidateSha256: string;
  repository: GoogleFontAdmissionRepository; storage: GoogleFontAdmissionStorage; signal: AbortSignal;
}) {
  for (const id of [input.organizationId, input.actorId, input.fontId]) z.string().uuid().parse(id);
  z.string().regex(/^[a-f0-9]{64}$/).parse(input.expectedCandidateSha256);
  input.signal.throwIfAborted();
  const font = registeredGoogleFontSchema.parse(await input.repository.readFont(input.organizationId, input.fontId, input.signal));
  const bundle = storedBundle.parse(await input.repository.readBundle(input.organizationId, input.fontId, input.expectedCandidateSha256, input.signal));
  if (font.organization_id !== input.organizationId || font.id !== input.fontId || bundle.organization_id !== input.organizationId
    || bundle.font_id !== input.fontId || bundle.candidate_sha256 !== input.expectedCandidateSha256
    || bundle.registration_css_url !== font.css_url) throw new GoogleFontBundleCommitError("STALE");
  if (bundle.status !== "PREPARED") throw new GoogleFontBundleCommitError("REVOKED");
  const identity = googleFontBundleIdentity(JSON.parse(bundle.manifest_text));
  if (identity.manifestText !== bundle.manifest_text || identity.candidateSha256 !== input.expectedCandidateSha256
    || identity.manifest.family !== font.family) throw new GoogleFontBundleCommitError("STALE");
  assertGoogleFontSelectorsUnambiguous(identity.manifest);
  const decoded = [];
  for (const file of identity.manifest.files) {
    input.signal.throwIfAborted();
    const bytes = await input.storage.readFile({ organizationId: input.organizationId, candidateSha256: identity.candidateSha256, file, signal: input.signal });
    if (bytes.byteLength !== file.fileSizeBytes || createHash("sha256").update(bytes).digest("hex") !== file.checksumSha256)
      throw new GoogleFontBundleCommitError("STALE");
    const metadata = await decodeGoogleFont(bytes, file.mimeType, input.signal);
    for (const face of identity.manifest.faces.filter(face => face.checksumSha256 === file.checksumSha256))
      assertGoogleFontFaceMetadata(font.family, face, metadata);
    decoded.push({ checksumSha256: file.checksumSha256, metadata });
  }
  input.signal.throwIfAborted();
  const refreshed = registeredGoogleFontSchema.parse(await input.repository.readFont(input.organizationId, input.fontId, input.signal));
  if (JSON.stringify(refreshed) !== JSON.stringify(font)) throw new GoogleFontBundleCommitError("STALE");
  const proofText = JSON.stringify({ format: GOOGLE_FONT_ADMISSION_FORMAT, decoder: "fontkit-2.0.4", bundleId: bundle.id,
    candidateSha256: identity.candidateSha256, family: font.family, files: decoded });
  if (Buffer.byteLength(proofText) > GOOGLE_FONT_PREPARATION_POLICY.manifestBytes) throw new Error("GOOGLE_FONT_ADMISSION_PROOF_LIMIT");
  const receipt = googleFontAdmissionReceiptSchema.parse(await input.repository.commitAdmission({ organizationId: input.organizationId,
    actorId: input.actorId, fontId: input.fontId, bundleId: bundle.id, candidateSha256: identity.candidateSha256, proofText, signal: input.signal }));
  input.signal.throwIfAborted();
  if (receipt.bundleId !== bundle.id || receipt.fontId !== font.id || receipt.candidateSha256 !== identity.candidateSha256
    || receipt.faceIds.length !== identity.manifest.faces.length) throw new Error("GOOGLE_FONT_ADMISSION_RECEIPT_MISMATCH");
  return receipt;
}

export function assertGoogleFontSelectorsUnambiguous(manifest: GoogleFontBundleManifest) {
  for (let index = 0; index < manifest.faces.length; index++) {
    const first = manifest.faces[index];
    for (const second of manifest.faces.slice(index + 1)) {
      if (first.style !== second.style || first.checksumSha256 === second.checksumSha256
        || first.weight.minimum > second.weight.maximum || second.weight.minimum > first.weight.maximum) continue;
      if (googleFontUnicodeIntervals(first.unicodeRange).some(range => googleFontUnicodeIntervals(second.unicodeRange)
        .some(other => range[0] <= other[1] && range[1] >= other[0]))) throw new Error("GOOGLE_FONT_FACE_SELECTOR_AMBIGUOUS");
    }
  }
}
