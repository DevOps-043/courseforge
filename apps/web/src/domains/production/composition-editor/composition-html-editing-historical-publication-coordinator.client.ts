import { z } from "zod";
import { htmlHistoricalCandidateViewSchema, type HtmlHistoricalCandidateView } from "./composition-html-editing-historical-candidate.contract";
import { consultHistoricalHtmlCandidate } from "./composition-html-editing-historical-candidate.client";
import { htmlHistoricalPublicationCommandSchema } from "./composition-html-editing-historical-publication.contract";
import { consultHistoricalHtmlPublication, sendHistoricalHtmlPublication } from "./composition-html-editing-historical-publication.client";
import { beginHistoricalHtmlJournal, htmlHistoricalJournalScopeSchema, readHistoricalHtmlJournal,
  recordHistoricalHtmlJournalReceipt, closeVerifiedHistoricalHtmlJournal, type HtmlHistoricalJournalScope } from "./composition-html-editing-historical-publication-journal.client";
import type { HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { boundedWait } from "./composition-html-editing-dispatch.client";
import { HTML_HISTORICAL_PUBLICATION_HTTP_POLICY as policy } from "./composition-html-editing-historical-publication-http.contract";

const actionSchema = z.discriminatedUnion("mode", [
  z.object({mode: z.literal("SEND"), candidate: htmlHistoricalCandidateViewSchema, confirmedHistoricalOnly: z.literal(true)}).strict(),
  z.object({mode: z.literal("RECOVER"), operationId: z.string().uuid()}).strict(),
  z.object({mode: z.literal("CLOSE_HISTORY"), operationId: z.string().uuid(), confirmedHistoryOnly: z.literal(true)}).strict(),
]);
export type HtmlHistoricalPublicationAction = z.infer<typeof actionSchema>;
export class HtmlHistoricalPublicationCoordinatorError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_READY" | "TRACKING_CHANGED" | "ACK_REQUIRED" | "OUTCOME_UNKNOWN") {
    super(`HTML_HISTORICAL_PUBLICATION_${code}`); this.name = "HtmlHistoricalPublicationCoordinatorError";
  }
}
function sameCandidate(first: HtmlHistoricalCandidateView, second: HtmlHistoricalCandidateView) {
  return JSON.stringify(htmlHistoricalCandidateViewSchema.parse(first)) === JSON.stringify(htmlHistoricalCandidateViewSchema.parse(second));
}
/** No native reservation/adoption/refresh is necessary: the transaction creates
 * inactive history only. Uses the existing draft lock for cooperative journals,
 * not a second lock engine. Caller must fence session/scope and explicitly show
 * inactive semantics; returned receipt must NEVER be installed as editor state. */
export async function coordinateHistoricalHtmlPublication(input: {
  scope: HtmlHistoricalJournalScope; action: HtmlHistoricalPublicationAction;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  signal: AbortSignal; isCurrent: () => boolean; fetcher?: typeof fetch; createOperationId?: () => string;
}) {
  let dispatched = false;
  try {
    const scope = htmlHistoricalJournalScopeSchema.parse(input.scope), action = actionSchema.parse(input.action);
    if (!input.storage || !input.lock) throw new HtmlHistoricalPublicationCoordinatorError("NOT_READY");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]);
    const guard = () => {signal.throwIfAborted(); if (!input.isCurrent()) throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");};
    guard();
    return await boundedWait(() => input.lock!.runExclusive({actorId: scope.actorId, organizationId: scope.organizationId, draftId: scope.draftId}, async () => {
      guard();
      let pending = await readHistoricalHtmlJournal(input.storage, scope); guard();
      if (action.mode === "SEND") {
        if (pending.status !== "EMPTY") throw new HtmlHistoricalPublicationCoordinatorError("NOT_READY");
        const {candidate} = action;
        if (candidate.actorId !== scope.actorId || candidate.organizationId !== scope.organizationId
          || candidate.compositionId !== scope.compositionId || candidate.draftId !== scope.draftId)
          throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
        const refreshed = await consultHistoricalHtmlCandidate({request: {...scope, request: candidate.request}, signal, fetcher: input.fetcher}); guard();
        if (!sameCandidate(candidate, refreshed)) throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
        const command = htmlHistoricalPublicationCommandSchema.parse({...scope,
          operationId: (input.createOperationId ?? (() => crypto.randomUUID()))(), request: candidate.request});
        const entry = await beginHistoricalHtmlJournal(input.storage, command); guard();
        if (!entry) throw new HtmlHistoricalPublicationCoordinatorError("NOT_READY");
        pending = await readHistoricalHtmlJournal(input.storage, scope); guard();
        if (pending.status !== "PENDING" || JSON.stringify(pending.entry) !== JSON.stringify(entry))
          throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
        dispatched = true;
        const receipt = await boundedWait(() => sendHistoricalHtmlPublication({command, requestSha256: entry.requestSha256, signal, fetcher: input.fetcher}), signal);
        guard();
        if (receipt.projectHash !== candidate.projectHash || receipt.originalRevisionId !== candidate.provenance.originalRevisionId
          || receipt.originalProjectHash !== candidate.provenance.originalProjectHash)
          throw new HtmlHistoricalPublicationCoordinatorError("OUTCOME_UNKNOWN");
        if (!await recordHistoricalHtmlJournalReceipt(input.storage, scope, entry, receipt)) throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
        guard(); return receipt;
      }
      if (pending.status !== "PENDING" || pending.entry.command.operationId !== action.operationId)
        throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
      // Reauthorize on every recovery, including when local metadata has an ACK.
      const entry = pending.entry;
      const result = await consultHistoricalHtmlPublication({command: entry.command, requestSha256: entry.requestSha256, signal, fetcher: input.fetcher}); guard();
      if (result.status !== "RECORDED") throw new HtmlHistoricalPublicationCoordinatorError("ACK_REQUIRED");
      if (!await recordHistoricalHtmlJournalReceipt(input.storage, scope, entry, result.receipt)) throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
      if (action.mode === "CLOSE_HISTORY") {
        guard();
        const recorded = await readHistoricalHtmlJournal(input.storage, scope); guard();
        if (recorded.status !== "PENDING" || recorded.entry.command.operationId !== entry.command.operationId
          || !recorded.entry.receipt || JSON.stringify(recorded.entry.receipt) !== JSON.stringify(result.receipt)
          || !await closeVerifiedHistoricalHtmlJournal(input.storage, scope, recorded.entry, () => {guard(); return true;}))
          throw new HtmlHistoricalPublicationCoordinatorError("TRACKING_CHANGED");
      }
      guard(); return result.receipt;
    }), signal);
  } catch (error) {
    if (error instanceof HtmlHistoricalPublicationCoordinatorError) throw error;
    throw new HtmlHistoricalPublicationCoordinatorError(dispatched ? "OUTCOME_UNKNOWN" : "NOT_READY");
  }
}
