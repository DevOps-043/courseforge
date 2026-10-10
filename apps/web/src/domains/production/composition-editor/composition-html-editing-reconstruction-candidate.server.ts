import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { verifyHtmlReconstructionArtifactMetadata } from "./composition-html-editing-reconstruction-handoff.server";
import { HTML_RECONSTRUCTION_POLICY as policy, htmlReconstructionReviewRecordSchema,
  type HtmlReconstructionReviewRecord } from "./composition-html-editing-reconstruction.contract";
import { buildVerifiedHtmlSnapshotRegistration } from "./composition-html-editing-snapshot-repository.server";
import { HTML_EDITING_COMPILATION_PROFILE } from "./html-editing/html-editing-compilation-profile";

type JsonValue = null | string | number | boolean | JsonValue[] | {[key: string]: JsonValue};
/** Transport-normalized JSON; native documents contain null and optional fields.
 * Unlike HTML canonicalization this is a private candidate transport digest. */
function canonical(value: JsonValue): string {
  return value === null || typeof value !== "object" ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const envelope = z.object({scope: z.literal("RECONSTRUCTION_CANDIDATE_NOT_CREATED_OR_PUBLISHED"),
  review: htmlReconstructionReviewRecordSchema, content: z.unknown(), registration: z.unknown(),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict();

/** Use only after independently loading sealed producer metadata. Does not run
 * the HTML compiler or rebuild the reviewed ZIP. Current authority is separate. */
export function describeHtmlReconstructionCandidate(input: {
  review: HtmlReconstructionReviewRecord; content: unknown; archiveSizeBytes: number;
}) {
  const review = htmlReconstructionReviewRecordSchema.parse(input.review);
  const content = verifyHtmlReconstructionArtifactMetadata(input.content), {candidate, prepared} = content;
  const locator = review.locator;
  if (!isDeepStrictEqual(review.origin, candidate.origin) || locator.targetCompositionId !== candidate.target.compositionId
    || locator.targetDocumentId !== candidate.target.documentId || locator.targetRevisionId !== candidate.target.revisionId
    || locator.projectHash !== prepared.projectHash
    || !isDeepStrictEqual(JSON.parse(prepared.bundle.encodedBundle).compilation.profile, HTML_EDITING_COMPILATION_PROFILE))
    throw new Error("HTML_RECONSTRUCTION_CANDIDATE_INVALID");
  const sizeBytes = z.number().int().positive().max(policy.candidateBytes).parse(input.archiveSizeBytes);
  const registration = buildVerifiedHtmlSnapshotRegistration({document: candidate.document,
    documentId: candidate.target.documentId, documentHash: candidate.documentHash, prepared,
    htmlUsedAssetIds: [...new Set(candidate.initialRevisions.flatMap(initial => initial.usedAssetIds))].sort(),
    archive: {projectHash: locator.projectHash, sizeBytes, storageBucket: "production-assets",
      storagePath: `composition-snapshots/${locator.organizationId}/${locator.targetCompositionId}/${locator.projectHash}.zip`}});
  const body = {scope: "RECONSTRUCTION_CANDIDATE_NOT_CREATED_OR_PUBLISHED" as const, review, content, registration};
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > policy.registrationBytes) throw new Error("HTML_RECONSTRUCTION_CANDIDATE_LIMIT");
  const candidateSha256 = digest(canonical(JSON.parse(serialized) as JsonValue));
  const described = {...body, candidateSha256};
  if (Buffer.byteLength(JSON.stringify(described)) > policy.registrationBytes) throw new Error("HTML_RECONSTRUCTION_CANDIDATE_LIMIT");
  return described;
}
export type HtmlReconstructionCandidate = ReturnType<typeof describeHtmlReconstructionCandidate>;

/** Stored JSONB may reorder keys. Rebuild only metadata/contract descriptors,
 * never HTML or ZIP bytes, and require the same transport digest and descriptor. */
export function readHtmlReconstructionCandidate(raw: unknown): HtmlReconstructionCandidate {
  const encoded = JSON.stringify(raw);
  if (!encoded || Buffer.byteLength(encoded) > policy.registrationBytes) throw new Error("HTML_RECONSTRUCTION_CANDIDATE_LIMIT");
  const parsed = envelope.parse(JSON.parse(encoded));
  const content = verifyHtmlReconstructionArtifactMetadata(parsed.content);
  const archive = z.object({archive: z.object({sizeBytes: z.number()}).passthrough()}).passthrough().parse(parsed.registration).archive;
  const expected = describeHtmlReconstructionCandidate({review: parsed.review, content, archiveSizeBytes: archive.sizeBytes});
  if (expected.candidateSha256 !== parsed.candidateSha256 || !isDeepStrictEqual(expected.registration, parsed.registration))
    throw new Error("HTML_RECONSTRUCTION_CANDIDATE_INVALID");
  return expected;
}
