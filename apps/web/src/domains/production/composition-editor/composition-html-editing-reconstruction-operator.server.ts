import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createHtmlHistoricalReconstructionArchivePreparer } from "./composition-html-editing-reconstruction-archive.server";
import { readReviewedHtmlReconstructionHandoff, type createHtmlReconstructionHandoff } from "./composition-html-editing-reconstruction-handoff.server";
import type { HtmlReconstructionReviewRepository } from "./composition-html-editing-reconstruction-review-repository.server";
import type { HtmlReconstructionRepository } from "./composition-html-editing-reconstruction-repository.server";
import type { createHtmlReconstructionReviewJournal } from "./composition-html-editing-reconstruction-review-journal.server";
import type { createHtmlReconstructionOperationJournal } from "./composition-html-editing-reconstruction-journal.server";
import { htmlReconstructionReviewRecordSchema } from "./composition-html-editing-reconstruction.contract";

export const htmlReconstructionOperatorIdentitySchema = z.object({actorId: z.string().uuid(), organizationId: z.string().uuid()}).strict();
type Identity = z.infer<typeof htmlReconstructionOperatorIdentitySchema>;
type Reviewed = Parameters<typeof readReviewedHtmlReconstructionHandoff>[0];

/** Private orchestration, not an HTTP approval endpoint. Every write is a separate
 * explicit action; no prepare→approve→create shortcut, retry or activation. */
export function createHtmlReconstructionOperatorWorkflow(ports: {
  prepare: ReturnType<typeof createHtmlHistoricalReconstructionArchivePreparer>;
  handoff: ReturnType<typeof createHtmlReconstructionHandoff>;
  reviews: Pick<HtmlReconstructionReviewRepository, "recordReviewed" | "read" | "revoke">;
  repository: Pick<HtmlReconstructionRepository, "stage" | "readStaging" | "create" | "readCreation">;
  reviewJournal: ReturnType<typeof createHtmlReconstructionReviewJournal>;
  operationJournal: ReturnType<typeof createHtmlReconstructionOperationJournal>;
  storeArchive: Parameters<HtmlReconstructionRepository["stage"]>[0]["storeArchive"];
}) {
  const {prepare, handoff, reviews, repository, reviewJournal, operationJournal, storeArchive} = ports;
  const scope = (identity: Identity, organizationId: string, reviewerId?: string) => {
    if (identity.organizationId !== organizationId || reviewerId !== undefined && identity.actorId !== reviewerId)
      throw new Error("HTML_RECONSTRUCTION_OPERATOR_FORBIDDEN");
  };
  async function localReview(candidateId: string, identity: Identity, signal?: AbortSignal) {
    const captured = htmlReconstructionOperatorIdentitySchema.parse(identity);
    const record = await reviewJournal.read(candidateId, signal);
    scope(captured, record.locator.organizationId, record.approval.reviewerId); return record;
  }
  async function localOperation(operationId: string, identity: Identity, signal?: AbortSignal) {
    const captured = htmlReconstructionOperatorIdentitySchema.parse(identity);
    const staging = await operationJournal.readStaging(operationId, signal);
    scope(captured, staging.review.locator.organizationId, staging.review.approval.reviewerId); return staging;
  }
  return {
    async prepareForReview(input: Parameters<typeof prepare>[0] & {candidateId: string}, identity: Identity) {
      const captured = htmlReconstructionOperatorIdentitySchema.parse(identity), owned = structuredClone({...input, signal: undefined});
      scope(captured, owned.request.organizationId, owned.request.actorId);
      const signal = input.signal; signal?.throwIfAborted();
      return handoff.save({candidateId: z.string().uuid().parse(owned.candidateId), artifact: await prepare({...owned, signal})}, signal);
    },
    async recordReview(input: Pick<Reviewed, "locator" | "approval" | "signal">, identity: Identity) {
      const captured = htmlReconstructionOperatorIdentitySchema.parse(identity), signal = input.signal;
      scope(captured, input.locator.organizationId, input.approval.reviewerId);
      const checked = await readReviewedHtmlReconstructionHandoff({...input, signal, handoff, authenticatedReviewerId: captured.actorId});
      const record = htmlReconstructionReviewRecordSchema.parse({scope: "RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY",
        locator: checked.locator, origin: checked.artifact.candidate.origin, approval: checked.approval});
      const preserved = await reviewJournal.preserve(structuredClone(record), signal);
      if (!isDeepStrictEqual(preserved, record)) throw new Error("HTML_RECONSTRUCTION_REVIEW_JOURNAL_UNCONFIRMED");
      return reviews.recordReviewed({handoff, locator: checked.locator, approval: checked.approval,
        authenticatedReviewerId: captured.actorId, signal});
    },
    async readReview(candidateId: string, identity: Identity, signal?: AbortSignal) {
      const record = await localReview(candidateId, identity, signal); return reviews.read(record, record.approval.reviewerId, signal);
    },
    async withdrawReview(candidateId: string, identity: Identity, signal?: AbortSignal) {
      const record = await localReview(candidateId, identity, signal); return reviews.revoke(record, record.approval.reviewerId, signal);
    },
    async stageAfterReview(candidateId: string, operationId: string, identity: Identity, signal?: AbortSignal) {
      // Capture before awaits; local/remote identity must agree. SQL checks current
      // review again atomically; a stale read here cannot authorize creation.
      const record = await localReview(candidateId, identity, signal), result = await reviews.read(record, record.approval.reviewerId, signal);
      if (result.status !== "RECORDED" || result.revoked || !isDeepStrictEqual(result.record, record))
        throw new Error("HTML_RECONSTRUCTION_REVIEW_UNAVAILABLE");
      return repository.stage({handoff, locator: record.locator, approval: record.approval, operationId,
        authenticatedReviewerId: record.approval.reviewerId, preserveStaging: operationJournal.preserveStaging, storeArchive, signal});
    },
    async readStaging(operationId: string, identity: Identity, signal?: AbortSignal) {
      const staging = await localOperation(operationId, identity, signal);
      return repository.readStaging(staging, staging.review.approval.reviewerId, signal);
    },
    async createAfterConfirmation(operationId: string, identity: Identity, signal?: AbortSignal) {
      const staging = await localOperation(operationId, identity, signal);
      return repository.create(staging, staging.review.approval.reviewerId, signal);
    },
    async readCreation(operationId: string, identity: Identity, signal?: AbortSignal) {
      const staging = await localOperation(operationId, identity, signal);
      return repository.readCreation(staging, staging.review.approval.reviewerId, signal);
    },
  };
}
