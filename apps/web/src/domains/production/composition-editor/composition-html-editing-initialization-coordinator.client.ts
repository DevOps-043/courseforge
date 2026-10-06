import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import type { HtmlEditingInspectorView } from "./html-editing/html-editing-inspector.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { readHtmlEditingNativePayload, type HtmlEditingNativePayload } from "./composition-html-editing-rebase.client";
import { consultHtmlEditingInspector } from "./composition-html-editing-http.client";
import { hashCompositionDocumentInBrowser } from "./composition-recovery-journal";
import { boundedWait } from "./composition-html-editing-dispatch.client";
import { sendHtmlEditingInitialization } from "./composition-html-editing-initialization-http.client";
import { htmlEditingInitializationRequestSchema, HTML_EDITING_INITIALIZATION_HTTP_POLICY,
  type HtmlEditingInitializationRequest } from "./composition-html-editing-initialization-http.contract";
import { beginHtmlEditingInitializationJournal, readHtmlEditingInitializationJournal,
  acknowledgeHtmlEditingInitializationJournal, closeVerifiedHtmlEditingInitializationJournal,
  type HtmlEditingInitializationJournalEntry } from "./composition-html-editing-initialization-journal.client";

export class HtmlEditingInitializationCoordinatorError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_READY" | "ACK_REQUIRED" | "TRACKING_CHANGED" | "OUTCOME_UNKNOWN" | "REFRESH_REQUIRED" | "UNVERIFIED") {
    super(`HTML_EDITING_INITIALIZATION_${code}`); this.name = "HtmlEditingInitializationCoordinatorError";
  }
}
export type HtmlEditingInitializationAction = { mode: "SEND"; clipId: string; body: HtmlEditingInitializationRequest }
  | { mode: "RECOVER"; operationId: string };

/** Registration leaves native source/document untouched. A direct ACK plus fresh
 * authorized native/inspector reads are required to close tracking. Unknown
 * outcomes cannot be inferred from matching content; recovery never POSTs. */
export async function coordinateHtmlEditingInitialization(input: {
  scope: HtmlSnapshotLocatorScope; action: HtmlEditingInitializationAction; loaded: HtmlEditingNativePayload;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  reserveNative: <T>(task: () => Promise<T>) => Promise<T>; isCurrent: () => boolean;
  signal: AbortSignal; fetcher?: typeof fetch; createOperationId?: () => string;
}): Promise<HtmlEditingInspectorView> {
  let dispatched = false, confirmed = false;
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope);
    if (!input.storage || !input.lock || input.signal.aborted) throw new HtmlEditingInitializationCoordinatorError("NOT_READY");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_INITIALIZATION_HTTP_POLICY.timeoutMs)]);
    return await boundedWait(() => input.lock!.runExclusive(scope, () => input.reserveNative(async () => {
      const guard = () => { signal.throwIfAborted(); if (!input.isCurrent()) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED"); };
      guard();
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
        if (!beginHtmlEditingInitializationJournal(input.storage, { scope, operationId, clipId, request: body, createdAt: Date.now() })) {
          throw new HtmlEditingInitializationCoordinatorError("NOT_READY");
        }
        const pending = readHtmlEditingInitializationJournal(input.storage, scope);
        if (pending.status !== "PENDING" || pending.entry.operationId !== operationId) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry; guard();
        dispatched = true;
        const ack = await boundedWait(() => sendHtmlEditingInitialization({ scope, clipId, body, signal, fetcher: input.fetcher }), signal);
        guard();
        if (!acknowledgeHtmlEditingInitializationJournal(input.storage, scope, entry, ack)) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        const acknowledged = readHtmlEditingInitializationJournal(input.storage, scope);
        if (acknowledged.status !== "PENDING" || acknowledged.entry.operationId !== operationId
          || JSON.stringify(acknowledged.entry.acknowledgment) !== JSON.stringify(ack)) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        entry = acknowledged.entry;
      } else {
        const operationId = z.string().uuid().parse(input.action.operationId);
        const pending = readHtmlEditingInitializationJournal(input.storage, scope);
        if (pending.status !== "PENDING" || pending.entry.operationId !== operationId) throw new HtmlEditingInitializationCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry;
      }
      if (!entry.acknowledgment) throw new HtmlEditingInitializationCoordinatorError("ACK_REQUIRED");
      confirmed = true; guard();
      const payload = await boundedWait(() => readHtmlEditingNativePayload(scope, signal, input.fetcher), signal);
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
