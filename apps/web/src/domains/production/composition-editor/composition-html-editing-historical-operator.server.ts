import type { createHistoricalHtmlCandidatePreparer } from "./composition-html-editing-historical-candidate.server";
import type { createHistoricalHtmlOperatorHandoff, HistoricalHtmlHandoffLocator } from "./composition-html-editing-historical-handoff.server";
import type { HistoricalHtmlPublicationRepository } from "./composition-html-editing-historical-publication-repository.server";

/** Private operator workflow; never install as a public approval endpoint.
 * Preparation writes only the private disk handoff. Approval is an independent
 * action after review of those frozen bytes; staging reuses them, never prepares
 * again. Repository durably records an attempt before its first remote write. */
export function createHistoricalHtmlOperatorWorkflow(ports: {
  prepare: ReturnType<typeof createHistoricalHtmlCandidatePreparer>;
  handoff: ReturnType<typeof createHistoricalHtmlOperatorHandoff>;
  repository: Pick<HistoricalHtmlPublicationRepository, "stageReviewedCandidate" | "readStaging">;
  storeArchive: Parameters<HistoricalHtmlPublicationRepository["stageReviewedCandidate"]>[0]["storeArchive"];
  recordStagingLocator?: Parameters<HistoricalHtmlPublicationRepository["stageReviewedCandidate"]>[0]["recordStagingLocator"];
}) {
  const {prepare, handoff, repository, storeArchive, recordStagingLocator} = ports;
  return {
    async prepareForReview(input: Parameters<typeof prepare>[0]) {
      return handoff.save(await prepare(input), input.signal);
    },
    async stageAfterReview(input: {locator: HistoricalHtmlHandoffLocator;
      approval: Parameters<HistoricalHtmlPublicationRepository["stageReviewedCandidate"]>[0]["approval"]; signal?: AbortSignal}) {
      const locator = structuredClone(input.locator), approval = structuredClone(input.approval), signal = input.signal;
      const artifact = await handoff.load(locator, signal);
      return repository.stageReviewedCandidate({artifact, approval, storeArchive, recordStagingLocator, signal});
    },
    // An uncertain remote write must be reconciled, never repeated by this flow.
    readStaging: repository.readStaging.bind(repository),
  };
}
