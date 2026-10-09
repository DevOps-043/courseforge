import { z } from "zod";
import { htmlLegacyAdoptionCommandSchema, htmlLegacyAdoptionRequestSchema, htmlLegacyAdoptionScopeSchema } from "./composition-html-editing-legacy-adoption.contract";
import { HTML_LEGACY_ADOPTION_HTTP_POLICY } from "./composition-html-editing-legacy-adoption-http-policy";
import { htmlSnapshotLocatorScopeSchema, readHtmlSnapshotTrackingAvailability,
  type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { readHtmlEditingJournal } from "./composition-html-editing-journal.client";
import { readHtmlEditingInitializationJournal } from "./composition-html-editing-initialization-journal.client";
import { hashCompositionDocumentInBrowser } from "./composition-recovery-journal";
import { boundedWait } from "./composition-html-editing-dispatch.client";
import { readHtmlEditingNativePayload, type HtmlEditingNativePayload } from "./composition-html-editing-rebase.client";
import { consultHtmlEditingInspector } from "./composition-html-editing-http.client";
import type { HtmlEditingInspectorView } from "./html-editing/html-editing-inspector.contract";
import { beginHtmlLegacyAdoptionJournal, readHtmlLegacyAdoptionJournal, recordHtmlLegacyAdoptionJournalReceipt,
  closeVerifiedHtmlLegacyAdoptionJournal, type HtmlLegacyAdoptionJournalEntry } from "./composition-html-editing-legacy-adoption-journal.client";
import { computeHtmlLegacyAdoptionRequestSha256InBrowser, sendHtmlLegacyAdoptionOperation,
  consultHtmlLegacyAdoptionOperation } from "./composition-html-editing-legacy-adoption-operation.client";

export class HtmlLegacyAdoptionCoordinatorError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_READY" | "TRACKING_CHANGED" | "ACK_REQUIRED" | "OUTCOME_UNKNOWN" | "REFRESH_REQUIRED" | "UNVERIFIED") {
    super(`HTML_LEGACY_ADOPTION_${code}`); this.name = "HtmlLegacyAdoptionCoordinatorError";
  }
}
const actionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("SEND"), clipId: htmlLegacyAdoptionScopeSchema.shape.clipId, request: htmlLegacyAdoptionRequestSchema }).strict(),
  z.object({ mode: z.literal("RECOVER"), operationId: z.string().uuid(), historicalOnly: z.boolean().optional() }).strict(),
]);
type Action = z.infer<typeof actionSchema>;
export type HtmlLegacyAdoptionVerifiedState = { payload: HtmlEditingNativePayload; view: HtmlEditingInspectorView | null };

/** Prepared UI integration boundary. Uses the existing cooperative draft lock /
 * native reservation, not a second lock engine. Host must fence owner and edits,
 * explicitly confirm the reviewed candidate and install the verified state before
 * journal closure. Historical-only recovery never reactivates HTML. */
export async function coordinateHtmlLegacyAdoption(input: {
  scope: HtmlSnapshotLocatorScope; action: Action; loaded: HtmlEditingNativePayload;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  reserveNative: <T>(task: () => Promise<T>) => Promise<T>; isCurrent: () => boolean;
  acceptVerified: (state: HtmlLegacyAdoptionVerifiedState, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal; fetcher?: typeof fetch; createOperationId?: () => string;
}): Promise<HtmlLegacyAdoptionVerifiedState> {
  let dispatched = false, confirmed = false;
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope);
    const action = actionSchema.parse(input.action);
    if (!input.storage || !input.lock || input.signal.aborted) throw new HtmlLegacyAdoptionCoordinatorError("NOT_READY");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_LEGACY_ADOPTION_HTTP_POLICY.timeoutMs)]);
    return await boundedWait(() => input.lock!.runExclusive(scope, () => input.reserveNative(async () => {
      const guard = () => { signal.throwIfAborted(); if (!input.isCurrent()) throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED"); };
      guard();
      let entry: HtmlLegacyAdoptionJournalEntry;
      if (action.mode === "SEND") {
        const command = htmlLegacyAdoptionCommandSchema.parse({ organizationId: scope.organizationId, documentId: scope.draftId,
          actorId: scope.actorId, clipId: action.clipId, operationId: (input.createOperationId ?? (() => crypto.randomUUID()))(), request: action.request });
        const clip = input.loaded.document.clips.find(candidate => candidate.id === command.clipId);
        if (readHtmlLegacyAdoptionJournal(input.storage, scope).status !== "EMPTY"
          || readHtmlEditingJournal(input.storage, scope).status !== "EMPTY"
          || readHtmlEditingInitializationJournal(input.storage, scope).status !== "EMPTY"
          || readHtmlSnapshotTrackingAvailability(input.storage, scope) !== "EMPTY"
          || input.loaded.documentHash !== command.request.expectedDocumentHash
          || await hashCompositionDocumentInBrowser(input.loaded.document) !== command.request.expectedDocumentHash
          || clip?.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE"
          || input.loaded.document.htmlEditing?.items.some(reference => reference.clipId === command.clipId))
          throw new HtmlLegacyAdoptionCoordinatorError("NOT_READY");
        guard();
        const requestSha256 = await computeHtmlLegacyAdoptionRequestSha256InBrowser(command); guard();
        if (!await beginHtmlLegacyAdoptionJournal(input.storage, { command, requestSha256, createdAt: Date.now() }))
          throw new HtmlLegacyAdoptionCoordinatorError("NOT_READY");
        const pending = readHtmlLegacyAdoptionJournal(input.storage, scope);
        if (pending.status !== "PENDING" || pending.entry.command.operationId !== command.operationId)
          throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry; guard(); dispatched = true;
        const receipt = await boundedWait(() => sendHtmlLegacyAdoptionOperation({ command, requestSha256, signal, fetcher: input.fetcher }), signal);
        guard();
        if (!await recordHtmlLegacyAdoptionJournalReceipt(input.storage, scope, entry, receipt))
          throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED");
      } else {
        const operationId = action.operationId;
        const pending = readHtmlLegacyAdoptionJournal(input.storage, scope);
        if (pending.status !== "PENDING" || pending.entry.command.operationId !== operationId)
          throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry;
        // Always consult the server, even when localStorage contains a receipt.
        const result = await boundedWait(() => consultHtmlLegacyAdoptionOperation({ command: entry.command,
          requestSha256: entry.requestSha256, signal, fetcher: input.fetcher }), signal);
        guard();
        if (result.status !== "RECORDED") throw new HtmlLegacyAdoptionCoordinatorError("ACK_REQUIRED");
        if (!await recordHtmlLegacyAdoptionJournalReceipt(input.storage, scope, entry, result.receipt))
          throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED");
      }
      const recorded = readHtmlLegacyAdoptionJournal(input.storage, scope);
      if (recorded.status !== "PENDING" || recorded.entry.command.operationId !== entry.command.operationId || !recorded.entry.receipt)
        throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED");
      entry = recorded.entry; confirmed = true; guard();
      const payload = await boundedWait(() => readHtmlEditingNativePayload(scope, signal, input.fetcher), signal);
      if (await hashCompositionDocumentInBrowser(payload.document) !== payload.documentHash
        || await hashCompositionDocumentInBrowser(input.loaded.document) !== input.loaded.documentHash)
        throw new HtmlLegacyAdoptionCoordinatorError("UNVERIFIED");
      const historicalOnly = action.mode === "RECOVER" && action.historicalOnly === true;
      let view: HtmlEditingInspectorView | null = null;
      if (historicalOnly) {
        if (payload.documentHash !== input.loaded.documentHash || payload.version !== input.loaded.version)
          throw new HtmlLegacyAdoptionCoordinatorError("REFRESH_REQUIRED");
      } else {
        const ack = entry.receipt!.acknowledgment;
        if (payload.documentHash !== ack.compositionDocumentHash || payload.version !== ack.compositionDocumentVersion
          || (input.loaded.documentHash !== entry.command.request.expectedDocumentHash && input.loaded.documentHash !== ack.compositionDocumentHash))
          throw new HtmlLegacyAdoptionCoordinatorError("REFRESH_REQUIRED");
        view = await boundedWait(() => consultHtmlEditingInspector({ scope: { organizationId: scope.organizationId,
          documentId: scope.draftId, clipId: entry.command.clipId }, signal, fetcher: input.fetcher }), signal);
        const binding = view.manifest.binding, clip = payload.document.clips.find(candidate => candidate.id === entry.command.clipId);
        const reference = payload.document.htmlEditing?.items.find(candidate => candidate.clipId === entry.command.clipId);
        if (view.compositionDocumentHash !== payload.documentHash || !view.usedResourcesGranted
          || binding.organizationId !== scope.organizationId || binding.documentId !== scope.draftId || binding.clipId !== entry.command.clipId
          || binding.documentSha256 !== entry.command.request.expectedDocumentHash
          || view.revisionVersion !== 1 || view.revisionSha256 !== ack.revisionSha256 || view.state.overrides.length !== 0
          || reference?.revisionVersion !== 1 || reference.revisionSha256 !== ack.revisionSha256
          || reference.templateId !== binding.templateId || reference.templateVersion !== binding.templateVersion
          || reference.sourceSha256 !== binding.sourceSha256 || reference.manifestSha256 !== binding.manifestSha256
          || clip?.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE") throw new HtmlLegacyAdoptionCoordinatorError("UNVERIFIED");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clip.source.html));
        if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("") !== binding.sourceSha256)
          throw new HtmlLegacyAdoptionCoordinatorError("UNVERIFIED");
      }
      guard();
      const state = { payload, view };
      await boundedWait(() => input.acceptVerified(state, signal), signal); guard();
      if (!closeVerifiedHtmlLegacyAdoptionJournal(input.storage, scope, entry)) throw new HtmlLegacyAdoptionCoordinatorError("TRACKING_CHANGED");
      return state;
    })), signal);
  } catch (error) {
    if (error instanceof HtmlLegacyAdoptionCoordinatorError) throw error;
    throw new HtmlLegacyAdoptionCoordinatorError(confirmed ? "REFRESH_REQUIRED" : dispatched ? "OUTCOME_UNKNOWN" : "NOT_READY");
  }
}
