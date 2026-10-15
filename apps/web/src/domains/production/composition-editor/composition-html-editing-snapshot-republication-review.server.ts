import { withAuthorizedHtmlSnapshotArchive } from "./composition-html-editing-snapshot-inspection-read.server";
import { readCompositionHtmlEditingCompilation } from "./composition-html-editing-reader.service";
import { prepareCompositionHtmlEditingSnapshotRepublication } from "./composition-html-editing-snapshot-bundle.server";
import { HTML_SNAPSHOT_REPUBLICATION_REVIEW_POLICY, htmlSnapshotRepublicationReviewSchema } from "./composition-html-editing-snapshot-republication-review.contract";

/** Explicit read-only preparation: exact saved native/HTML pointers and CURRENT
 * grants, never archive-supplied permission or a substituted latest document.
 * New current-profile bundle is separate; original remains non-executable.
 * No approval record, full ZIP, upload, activation or native/history mutation. */
export async function readAuthorizedHtmlSnapshotRepublicationReview(input: Parameters<typeof withAuthorizedHtmlSnapshotArchive>[0]) {
  try {
    return await withAuthorizedHtmlSnapshotArchive(input, async ({ request, identity, inspected }, signal) => {
      if (inspected.diagnostic.status !== "LEGACY_V1_REQUIRES_REVIEW"
        && inspected.diagnostic.status !== "PROFILE_MISMATCH_REQUIRES_REVIEW") throw new Error();
      const exactRead = { actorId: request.actorId, organizationId: request.organizationId,
        documentId: identity.documentId, documentHash: identity.documentHash, supabase: input.supabase, signal };
      const prepare = async () => {
        const saved = await readCompositionHtmlEditingCompilation(exactRead);
        return prepareCompositionHtmlEditingSnapshotRepublication({ ...inspected.bundle,
          scope: { organizationId: identity.organizationId, documentId: identity.documentId },
          document: saved.document, documentHash: identity.documentHash, authorities: saved.context.revisions });
      };
      const candidate = await prepare();
      // Revalidate revocation/grants and exact content before returning a review.
      const refreshed = await prepare();
      if (candidate.candidate.sha256 !== refreshed.candidate.sha256) throw new Error();
      const review = htmlSnapshotRepublicationReviewSchema.parse({ ...request,
        scope: "PREPARED_HISTORICAL_HTML_REVIEW_NOT_APPROVED_OR_PUBLISHED",
        publicationMode: "HISTORICAL_REVISION_WITHOUT_ACTIVATION_OR_DRAFT_CHANGE",
        documentId: identity.documentId, documentHash: identity.documentHash, originalProjectHash: identity.projectHash,
        originalBundleSha256: candidate.originalBundleSha256, originalFormat: candidate.originalFormat,
        originalCompilationProfile: candidate.originalCompilationProfile,
        candidateCompilationProfile: candidate.candidateCompilationProfile, candidateBundleSha256: candidate.candidate.sha256,
        comparisons: candidate.comparisons, unmatchedPriorClipIds: candidate.unmatchedPriorClipIds, requiredReviews: candidate.requiredReviews,
      });
      if (Buffer.byteLength(JSON.stringify(review), "utf8") > HTML_SNAPSHOT_REPUBLICATION_REVIEW_POLICY.responseBytes) throw new Error();
      return review;
    });
  } catch {
    input.signal?.throwIfAborted(); throw new Error("HTML_SNAPSHOT_REPUBLICATION_REVIEW_UNAVAILABLE");
  }
}
