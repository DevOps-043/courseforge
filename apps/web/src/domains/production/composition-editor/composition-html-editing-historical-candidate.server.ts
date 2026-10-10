import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { readAuthorizedHtmlSnapshotRepublicationReview } from "./composition-html-editing-snapshot-republication-review.server";
import { readCompositionHtmlEditingCompilation } from "./composition-html-editing-reader.service";
import { readHtmlSnapshotNativeMedia } from "./composition-html-editing-snapshot-media.server";
import { createHtmlSnapshotFontAcquirer, revalidateHtmlSnapshotFontAuthority } from "./composition-html-editing-snapshot-fonts.server";
import { prepareCompositionHtmlEditingSnapshotArchive } from "./composition-html-editing-snapshot-archive.server";
import { HTML_HISTORICAL_PUBLICATION_MODE, HTML_HISTORICAL_PUBLICATION_POLICY as policy, htmlHistoricalPublicationProvenanceSchema } from "./composition-html-editing-historical-publication.contract";
import { htmlSnapshotInspectionReadRequestSchema, type HtmlSnapshotInspectionReadRequest } from "./composition-html-editing-snapshot-inspection.contract";
import { hyperframesRenderProfileSchema } from "../hyperframes/hyperframes.types";
import { controlledRenderExecutionContractSchema } from "./composition-render-execution-contract";

type ArchivePreparation = Parameters<typeof prepareCompositionHtmlEditingSnapshotArchive>[0];
type RuntimeSettings = Pick<ArchivePreparation, "renderProfile" | "renderExecution" | "animationRuntimeSha256">;
let activePreparations = 0;

/** Private operator preparation, no upload/approval/write or execution. Host
 * supplies runtime settings; never accept URLs/resources/fonts/source from HTTP.
 * Artifact must be reviewed as exact ZIP hash before staging approval, not just
 * the earlier HTML bundle. Future staging MUST preserve these bytes unchanged. */
export function createHistoricalHtmlCandidatePreparer(configuration: {
  supabase: SupabaseClient; supabaseUrl: string; serviceRoleKey: string; fetchImpl?: typeof fetch;
}) {
  const {supabase, supabaseUrl, serviceRoleKey, fetchImpl} = configuration;
  const acquireFonts = createHtmlSnapshotFontAcquirer({supabase, supabaseUrl, serviceRoleKey, fetchImpl});
  return async (input: RuntimeSettings & { request: HtmlSnapshotInspectionReadRequest; candidateId: string; signal?: AbortSignal }) => {
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(policy.preparationTimeoutMs)])
      : AbortSignal.timeout(policy.preparationTimeoutMs);
    signal.throwIfAborted();
    if (activePreparations >= policy.maximumConcurrentPreparations) throw new Error("HTML_HISTORICAL_CANDIDATE_PREPARATION_BUSY");
    activePreparations++;
    try {
      // Own identity and runtime settings before any await. Operator references
      // may be released/mutated while reading the historical archive.
      const candidateId = z.string().uuid().parse(input.candidateId);
      const request = htmlSnapshotInspectionReadRequestSchema.parse(input.request);
      const renderProfile = structuredClone(hyperframesRenderProfileSchema.parse(input.renderProfile));
      const renderExecution = controlledRenderExecutionContractSchema.parse(input.renderExecution);
      const animationRuntimeSha256 = z.string().regex(/^[a-f0-9]{64}$/).parse(input.animationRuntimeSha256);
      const read = { request, supabase, storageOrigin: supabaseUrl, fetchResource: fetchImpl, signal };
      const review = await readAuthorizedHtmlSnapshotRepublicationReview(read);
      const provenance = htmlHistoricalPublicationProvenanceSchema.parse({ candidateId,
        organizationId: review.organizationId, compositionId: review.compositionId, draftId: review.draftId,
        originalRevisionId: review.revisionId, originalProjectHash: review.originalProjectHash,
        originalBundleSha256: review.originalBundleSha256, documentId: review.documentId, documentHash: review.documentHash,
        candidateBundleSha256: review.candidateBundleSha256, publicationMode: HTML_HISTORICAL_PUBLICATION_MODE });
      const exact = { actorId: review.actorId, organizationId: review.organizationId, documentId: review.documentId,
        documentHash: review.documentHash, supabase, signal };
      const saved = await readCompositionHtmlEditingCompilation(exact);
      const media = await readHtmlSnapshotNativeMedia({ supabase, organizationId: review.organizationId,
        draftId: review.documentId, document: saved.document, signal });
      const packagedFonts = await acquireFonts({ document: saved.document, organizationId: review.organizationId, signal });
      const prepared = await prepareCompositionHtmlEditingSnapshotArchive({ ...exact, otherAssets: media.assets,
        deckPublicUrls: media.deckPublicUrls, packagedFonts, historicalRepublication: provenance,
        renderProfile, renderExecution, animationRuntimeSha256 });
      if (prepared.bundle.sha256 !== provenance.candidateBundleSha256 || prepared.projectHash === provenance.originalProjectHash) throw new Error();
      const refreshed = await readAuthorizedHtmlSnapshotRepublicationReview(read);
      if (!isDeepStrictEqual(review, refreshed)) throw new Error();
      const refreshedMedia = await readHtmlSnapshotNativeMedia({supabase, organizationId: review.organizationId,
        draftId: review.documentId, document: saved.document, signal});
      if (!isDeepStrictEqual(media, refreshedMedia)) throw new Error();
      await revalidateHtmlSnapshotFontAuthority(supabase, {organizationId: review.organizationId,
        manifest: prepared.fontManifest, signal});
      signal.throwIfAborted();
      return { scope: "PREPARED_HISTORICAL_ARCHIVE_NOT_APPROVED_UPLOADED_OR_PUBLISHED" as const, provenance, review, prepared };
    } catch {
      signal.throwIfAborted(); throw new Error("HTML_HISTORICAL_CANDIDATE_PREPARATION_UNAVAILABLE");
    } finally {activePreparations--;}
  };
}
