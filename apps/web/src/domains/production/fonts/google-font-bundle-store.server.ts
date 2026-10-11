import { createHash } from "node:crypto";
import { z } from "zod";
import { googleFontBundleIdentity, googleFontCandidateBundle } from "./google-font-bundle-identity.server";
import { googleFontBundleReceiptSchema, googleFontMaterializationRequestSchema, type GoogleFontBundleManifest } from "./google-font-bundle.contract";
import { prepareGoogleFontBytes } from "./google-font-preparation.server";
import { registeredGoogleFontSchema, type GoogleFontPreparationRepository } from "./google-font-preparation-query.server";
import { googleFontPreparationInputSchema, GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";

export type GoogleFontBundleStore = GoogleFontPreparationRepository & {
  readBundle(organizationId: string, fontId: string, candidateSha256: string, signal: AbortSignal): Promise<unknown | null>;
  commitBundle(input: { organizationId: string; actorId: string; fontId: string; family: string; cssUrl: string;
    candidateSha256: string; manifestText: string; signal: AbortSignal }): Promise<unknown>;
};
export type GoogleFontBundleStorage = {
  /** No upsert. An unknown/duplicate upload is resolved by bounded byte readback.
   * Without bytes, verify the existing immutable object; never contact Google. */
  ensureFile(input: { organizationId: string; candidateSha256: string; file: GoogleFontBundleManifest["files"][number];
    bytes?: Uint8Array; signal: AbortSignal }): Promise<void>;
};
export class GoogleFontBundleCommitError extends Error {
  constructor(readonly reason: "FORBIDDEN" | "STALE" | "REVOKED") { super(`GOOGLE_FONT_BUNDLE_${reason}`); this.name = "GoogleFontBundleCommitError"; }
}
const storedBundleSchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), font_id: z.string().uuid(),
  candidate_sha256: z.string().regex(/^[a-f0-9]{64}$/), manifest_text: z.string().max(GOOGLE_FONT_PREPARATION_POLICY.manifestBytes), registration_css_url: z.string().max(2000),
  status: z.enum(["PREPARED", "REVOKED"]),
}).strict();

/** Persists structural candidates only, never a native font grant or READY asset.
 * Storage is outside SQL: a failed commit can leave unreferenced private files.
 * The same reviewed hash is retryable, with reauthorization and byte readback. */
export async function persistRegisteredGoogleFont(input: {
  organizationId: string; actorId: string; fontId: string; expectedCandidateSha256: string;
  repository: GoogleFontBundleStore; storage: GoogleFontBundleStorage; signal: AbortSignal; fetchImpl?: typeof fetch;
}) {
  for (const id of [input.organizationId, input.actorId, input.fontId]) z.string().uuid().parse(id);
  googleFontMaterializationRequestSchema.parse({ expectedCandidateSha256: input.expectedCandidateSha256 });
  input.signal.throwIfAborted();
  const registered = registeredGoogleFontSchema.safeParse(await input.repository.readFont(input.organizationId, input.fontId, input.signal));
  input.signal.throwIfAborted();
  if (!registered.success || registered.data.organization_id !== input.organizationId || registered.data.id !== input.fontId) throw new GoogleFontBundleCommitError("STALE");
  const preparation = googleFontPreparationInputSchema.safeParse({ family: registered.data.family, cssUrl: registered.data.css_url });
  if (!preparation.success) throw new GoogleFontBundleCommitError("STALE");
  const existing = await input.repository.readBundle(input.organizationId, input.fontId, input.expectedCandidateSha256, input.signal);
  input.signal.throwIfAborted();
  let identity: ReturnType<typeof googleFontBundleIdentity>;
  const bytesByHash = new Map<string, Uint8Array>();
  if (existing !== null) {
    const stored = storedBundleSchema.parse(existing);
    if (stored.organization_id !== input.organizationId || stored.font_id !== input.fontId || stored.candidate_sha256 !== input.expectedCandidateSha256
      || stored.registration_css_url !== registered.data.css_url) throw new GoogleFontBundleCommitError("STALE");
    if (stored.status === "REVOKED") throw new GoogleFontBundleCommitError("REVOKED");
    identity = googleFontBundleIdentity(JSON.parse(stored.manifest_text));
    if (identity.manifestText !== stored.manifest_text) throw new GoogleFontBundleCommitError("STALE");
  } else {
    const candidate = await prepareGoogleFontBytes(preparation.data, { signal: input.signal, fetchImpl: input.fetchImpl });
    identity = googleFontCandidateBundle(candidate);
    for (const file of candidate.files) {
      const bytes = new Uint8Array(file.bytes);
      if (bytes.length !== file.fileSizeBytes || createHash("sha256").update(bytes).digest("hex") !== file.checksumSha256) throw new GoogleFontBundleCommitError("STALE");
      bytesByHash.set(file.checksumSha256, bytes);
    }
  }
  if (identity.candidateSha256 !== input.expectedCandidateSha256 || identity.manifest.family !== registered.data.family) throw new GoogleFontBundleCommitError("STALE");
  for (const file of identity.manifest.files) {
    input.signal.throwIfAborted();
    await input.storage.ensureFile({ organizationId: input.organizationId, candidateSha256: identity.candidateSha256, file,
      bytes: bytesByHash.get(file.checksumSha256), signal: input.signal });
  }
  input.signal.throwIfAborted();
  const refreshed = registeredGoogleFontSchema.safeParse(await input.repository.readFont(input.organizationId, input.fontId, input.signal));
  if (!refreshed.success || JSON.stringify(refreshed.data) !== JSON.stringify(registered.data)) throw new GoogleFontBundleCommitError("STALE");
  // Commit rechecks live actor, registry and Storage object metadata under SQL locks.
  const result = await input.repository.commitBundle({ organizationId: input.organizationId, actorId: input.actorId, fontId: input.fontId,
    family: registered.data.family, cssUrl: registered.data.css_url, candidateSha256: identity.candidateSha256,
    manifestText: identity.manifestText, signal: input.signal });
  input.signal.throwIfAborted();
  const receipt = googleFontBundleReceiptSchema.parse(result);
  if (receipt.candidateSha256 !== identity.candidateSha256 || existing !== null && receipt.bundleId !== storedBundleSchema.parse(existing).id) throw new Error("GOOGLE_FONT_BUNDLE_RECEIPT_MISMATCH");
  return receipt;
}
