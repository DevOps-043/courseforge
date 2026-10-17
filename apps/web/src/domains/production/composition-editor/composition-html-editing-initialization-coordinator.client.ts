import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import type { HtmlEditingInspectorView } from "./html-editing/html-editing-inspector.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { readHtmlEditingNativePayload, type HtmlEditingNativePayload } from "./composition-html-editing-rebase.client";
import { consultHtmlEditingInspector } from "./composition-html-editing-http.client";
import { hashCompositionDocumentInBrowser } from "./composition-recovery-journal";
import { boundedWait } from "./composition-html-editing-dispatch.client";
import { computeHtmlEditingInitializationRequestSha256InBrowser, sendHtmlEditingInitializationOperation,
  consultHtmlEditingInitializationOperation } from "./composition-html-editing-initialization-operation.client";
import { htmlEditingInitializationRequestSchema, HTML_EDITING_INITIALIZATION_HTTP_POLICY,
  type HtmlEditingInitializationRequest } from "./composition-html-editing-initialization-http.contract";
import { beginHtmlEditingInitializationJournal, readHtmlEditingInitializationJournal,
  recordHtmlEditingInitializationJournalReceipt, closeVerifiedHtmlEditingInitializationJournal,
  type HtmlEditingInitializationJournalEntry } from "./composition-html-editing-initialization-journal.client";

export class HtmlEditingInitializationCoordinatorError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_READY" | "ACK_REQUIRED" | "TRACKING_CHANGED" | "OUTCOME_UNKNOWN" | "REFRESH_REQUIRED" | "UNVERIFIED") {
    super(`HTML_EDITING_INITIALIZATION_${code}`); this.name = "HtmlEditingInitializationCoordinatorError";
  }
}
export type HtmlEditingInitializationAction = { mode: "SEND"; clipId: string; body: HtmlEditingInitializationRequest }
  | { mode: "RECOVER"; operationId: string; historicalOnly?: boolean };

/** Registration leaves native source/document untouched. An exact operation receipt plus fresh
 * authorized native/inspector reads are required to close tracking. Unknown
 * outcomes cannot be inferred from matching content; recovery never POSTs. */
export async function coordinateHtmlEditingInitialization(input: {
  scope: HtmlSnapshotLocatorScope; action: HtmlEditingInitializationAction; loaded: HtmlEditingNativePayload;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  reserveNative: <T>(task: () => Promise<T>) => Promise<T>; isCurrent: () => boolean;
  signal: AbortSignal; fetcher?: typeof fetch; createOperationId?: () => string;
}): Promise<HtmlEditingInspectorView | null> {
  let dispatched = false, confirmed = false;
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope);
    if (!input.storage || !input.lock || input.signal.aborted) throw new HtmlEditingInitializationCoordinatorError("NOT_READY");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_INITIALIZATION_HTTP_POLICY.timeoutMs)]);
    return await boundedWait(() => input.lock!.runExclusive(scope, () => input.reserveNative(async () => {
      const guard = () => { signal.throwIfAborted(); if (!input.isCurrent()) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED"); };
      guard();
      const historicalOnly = input.action.mode === "RECOVER" && input.action.historicalOnly === true;
      let entry: HtmlEditingInitializationJournalEntry;
      if (input.action.mode === "SEND") {
        const body = htmlEditingInitializationRequestSchema.parse(input.action.body);
        const clipId = htmlEditingBindingSchema.shape.clipId.parse(input.action.clipId);
        const clip = input.loaded.document.clips.find(item => item.id === clipId);
        if (readHtmlEditingInitializationJournal(input.storage, scope).status !== "EMPTY"
          || input.loaded.documentHash !== body.expectedDocumentHash
          || await hashCompositionDocumentInBrowser(input.loaded.document) !== body.expectedDocumentHash
          || clip?.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE"
          || input.loaded.document.htmlEditing?.items.some(item => item.clipId === clipId)) throw new HtmlEditingInitializationCoordinatorError("NOT_READY");
        guard();
        const operationId = z.string().uuid().parse((input.createOperationId ?? (() => crypto.randomUUID()))());
        const requestSha256 = await computeHtmlEditingInitializationRequestSha256InBrowser(body);
        guard();
        if (!beginHtmlEditingInitializationJournal(input.storage, { scope, operationId, clipId, request: body, requestSha256, createdAt: Date.now() })) {
          throw new HtmlEditingInitializationCoordinatorError("NOT_READY");
        }
        const pending = readHtmlEditingInitializationJournal(input.storage, scope);
        if (pending.status !== "PENDING" || pending.entry.operationId !== operationId) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry; guard();
        dispatched = true;
        const receipt = await boundedWait(() => sendHtmlEditingInitializationOperation({ scope, clipId, body,
          operationId, requestSha256, signal, fetcher: input.fetcher }), signal);
        guard();
        if (!recordHtmlEditingInitializationJournalReceipt(input.storage, scope, entry, receipt)) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        const acknowledged = readHtmlEditingInitializationJournal(input.storage, scope);
        if (acknowledged.status !== "PENDING" || acknowledged.entry.operationId !== operationId
          || JSON.stringify(acknowledged.entry.acknowledgment) !== JSON.stringify(receipt.acknowledgment)) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        entry = acknowledged.entry;
      } else {
        const operationId = z.string().uuid().parse(input.action.operationId);
        const pending = readHtmlEditingInitializationJournal(input.storage, scope);
        if (pending.status !== "PENDING" || pending.entry.operationId !== operationId) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry;
        if (historicalOnly && !entry.requestSha256) throw new HtmlEditingInitializationCoordinatorError("ACK_REQUIRED");
        if ((!entry.acknowledgment || historicalOnly) && entry.requestSha256) {
          if (await computeHtmlEditingInitializationRequestSha256InBrowser(entry.request) !== entry.requestSha256)
            throw new HtmlEditingInitializationCoordinatorError("UNVERIFIED");
          guard();
          const result = await boundedWait(() => consultHtmlEditingInitializationOperation({ scope, clipId: entry.clipId,
            operationId, requestSha256: entry.requestSha256!, signal, fetcher: input.fetcher }), signal);
          guard();
          if (result.status !== "RECORDED") throw new HtmlEditingInitializationCoordinatorError("ACK_REQUIRED");
          if (!recordHtmlEditingInitializationJournalReceipt(input.storage, scope, entry, result.receipt))
            throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
          const acknowledged = readHtmlEditingInitializationJournal(input.storage, scope);
          if (acknowledged.status !== "PENDING" || acknowledged.entry.operationId !== operationId
            || JSON.stringify(acknowledged.entry.acknowledgment) !== JSON.stringify(result.receipt.acknowledgment))
            throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
          entry = acknowledged.entry;
        }
      }
      if (!entry.acknowledgment) throw new HtmlEditingInitializationCoordinatorError("ACK_REQUIRED");
      confirmed = true; guard();
      const payload = await boundedWait(() => readHtmlEditingNativePayload(scope, signal, input.fetcher), signal);
      if (historicalOnly) {
        if (payload.documentHash !== input.loaded.documentHash || payload.version !== input.loaded.version
          || await hashCompositionDocumentInBrowser(input.loaded.document) !== input.loaded.documentHash)
          throw new HtmlEditingInitializationCoordinatorError("REFRESH_REQUIRED");
        if (await hashCompositionDocumentInBrowser(payload.document) !== payload.documentHash)
          throw new HtmlEditingInitializationCoordinatorError("UNVERIFIED");
        guard();
        if (!closeVerifiedHtmlEditingInitializationJournal(input.storage, scope, entry))
          throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        // Confirms this historical registration only, not current editable fields.
        return null;
      }
      const view = await boundedWait(() => consultHtmlEditingInspector({ scope: { organizationId: scope.organizationId,
        documentId: scope.draftId, clipId: entry.clipId }, signal, fetcher: input.fetcher }), signal);
      const binding = view.manifest.binding, clip = payload.document.clips.find(item => item.id === entry.clipId);
      if (payload.documentHash !== input.loaded.documentHash || payload.version !== input.loaded.version
        || payload.documentHash !== entry.request.expectedDocumentHash
        || await hashCompositionDocumentInBrowser(input.loaded.document) !== input.loaded.documentHash) throw new HtmlEditingInitializationCoordinatorError("REFRESH_REQUIRED");
      if (await hashCompositionDocumentInBrowser(payload.document) !== payload.documentHash
        || view.compositionDocumentHash !== payload.documentHash || binding.organizationId !== scope.organizationId
        || binding.documentId !== scope.draftId || binding.clipId !== entry.clipId
        || binding.templateId !== entry.request.templateId || binding.templateVersion !== entry.request.templateVersion
        || view.revisionVersion !== 1 || view.revisionSha256 !== entry.acknowledgment.sha256 || view.state.overrides.length !== 0
        || clip?.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE"
        || payload.document.htmlEditing?.items.some(item => item.clipId === entry.clipId)) throw new HtmlEditingInitializationCoordinatorError("UNVERIFIED");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clip.source.html));
      const sourceSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (sourceSha256 !== binding.sourceSha256) throw new HtmlEditingInitializationCoordinatorError("UNVERIFIED");
      guard();
      if (!closeVerifiedHtmlEditingInitializationJournal(input.storage, scope, entry)) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
      return view;
    })), signal);
  } catch (error) {
    if (error instanceof HtmlEditingInitializationCoordinatorError) throw error;
    throw new HtmlEditingInitializationCoordinatorError(confirmed ? "REFRESH_REQUIRED" : dispatched ? "OUTCOME_UNKNOWN" : "NOT_READY");
  }
}
