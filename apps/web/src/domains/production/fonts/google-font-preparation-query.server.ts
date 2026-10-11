import { z } from "zod";
import { prepareGoogleFontBytes } from "./google-font-preparation.server";
import { googleFontPreparationInputSchema } from "./google-font-preparation-policy";
import { googleFontCandidateBundle } from "./google-font-bundle-identity.server";

export type GoogleFontPreparationRepository = {
  readFont(organizationId: string, fontId: string, signal: AbortSignal): Promise<unknown | null>;
};

export const registeredGoogleFontSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), family: z.string(),
  source: z.literal("google"), css_url: z.string(), status: z.literal("READY"),
}).strict();

/** Registration is not native authority. Query one current tenant-owned font,
 * then return descriptors/hashes only; never disclose candidate bytes or URLs. */
export async function inspectRegisteredGoogleFont(input: {
  organizationId: string; fontId: string; repository: GoogleFontPreparationRepository;
  signal: AbortSignal; fetchImpl?: typeof fetch;
}) {
  z.string().uuid().parse(input.organizationId);
  z.string().uuid().parse(input.fontId);
  input.signal.throwIfAborted();
  const row = await input.repository.readFont(input.organizationId, input.fontId, input.signal);
  input.signal.throwIfAborted();
  if (row === null) return { ok: false, reason: "NOT_FOUND" } as const;
  const parsed = registeredGoogleFontSchema.safeParse(row);
  if (!parsed.success || parsed.data.id !== input.fontId || parsed.data.organization_id !== input.organizationId) {
    return { ok: false, reason: "NOT_PREPARABLE" } as const;
  }
  const preparation = googleFontPreparationInputSchema.safeParse({ family: parsed.data.family, cssUrl: parsed.data.css_url });
  if (!preparation.success) return { ok: false, reason: "NOT_PREPARABLE" } as const;
  const candidate = await prepareGoogleFontBytes(preparation.data, { signal: input.signal, fetchImpl: input.fetchImpl });
  const bundle = googleFontCandidateBundle(candidate);
  return { ok: true, candidate: {
    fontId: input.fontId, source: candidate.source, family: candidate.family, scope: candidate.scope,
    candidateSha256: bundle.candidateSha256, stylesheetChecksumSha256: candidate.stylesheetChecksumSha256,
    totalBytes: bundle.manifest.files.reduce((total, file) => total + file.fileSizeBytes, 0),
    uniqueFiles: bundle.manifest.files.length, faces: candidate.faces, renderEligible: false as const,
    status: "NATIVE_BUNDLE_INTEGRATION_REQUIRED" as const,
  } } as const;
}
