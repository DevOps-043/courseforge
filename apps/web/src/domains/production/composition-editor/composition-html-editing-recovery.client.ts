import { z } from "zod";
import { readHtmlEditingJournal, recordHtmlEditingJournalReceipt, closeRebasedHtmlEditingJournal, closeHistoricallyConfirmedHtmlEditingJournal, type HtmlEditingJournalEntry } from "./composition-html-editing-journal.client";
import { consultHtmlEditingOperation } from "./composition-html-editing-operation-http.client";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { readHtmlEditingNativePayload, HTML_EDITING_REBASE_POLICY, type HtmlEditingNativePayload } from "./composition-html-editing-rebase.client";
import { consultHtmlEditingInspector } from "./composition-html-editing-http.client";
import { hashCompositionDocumentInBrowser } from "./composition-recovery-journal";
import { boundedWait } from "./composition-html-editing-dispatch.client";

export class HtmlEditingRecoveryError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_READY" | "ACK_REQUIRED" | "RECEIPT_NOT_FOUND" | "TRACKING_CHANGED" | "RELOAD_REQUIRED" | "UNVERIFIED") {
    super(`HTML_EDITING_RECOVERY_${code}`); this.name = "HtmlEditingRecoveryError";
  }
}

/** Closes only a directly acknowledged or durably receipted operation whose exact revision is still
 * current and already loaded. Explicit historicalOnly instead confirms durable
 * causality with fresh authorization, without asserting ACK.next is current.
 * No POST, adoption, merge, history recreation or
 * inference of a missing ACK from matching content. Local journal is not authority. */
export async function recoverAcknowledgedHtmlEditingOperation(input: {
  scope: HtmlSnapshotLocatorScope; operationId: string; loaded: HtmlEditingNativePayload;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  reserveNative: <T>(task: () => Promise<T>) => Promise<T>;
  isCurrent: () => boolean; signal?: AbortSignal; fetcher?: typeof fetch;
  historicalOnly?: boolean;
}): Promise<void> {
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), operationId = z.string().uuid().parse(input.operationId);
    if (!input.storage || !input.lock || input.signal?.aborted) throw new HtmlEditingRecoveryError("NOT_READY");
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REBASE_POLICY.timeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_REBASE_POLICY.timeoutMs);
    await boundedWait(() => input.lock!.runExclusive(scope, () => input.reserveNative(async () => {
      signal.throwIfAborted();
      if (!input.isCurrent()) throw new HtmlEditingRecoveryError("NOT_READY");
      const initial = readHtmlEditingJournal(input.storage, scope);
      if (initial.status !== "PENDING" || initial.entry.operationId !== operationId) throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
      let entry: HtmlEditingJournalEntry = initial.entry;
      if (!entry.acknowledgment || input.historicalOnly) {
        if (!entry.requestSha256) throw new HtmlEditingRecoveryError("ACK_REQUIRED");
        const result = await boundedWait(() => consultHtmlEditingOperation({ scope, operationId,
          clipId: entry.clipId, requestSha256: entry.requestSha256!, signal, fetcher: input.fetcher }), signal);
        signal.throwIfAborted();
        const tracking = readHtmlEditingJournal(input.storage, scope);
        if (!input.isCurrent() || tracking.status !== "PENDING" || JSON.stringify(tracking.entry) !== JSON.stringify(entry)) {
          throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
        }
        if (result.status === "NOT_FOUND") throw new HtmlEditingRecoveryError("RECEIPT_NOT_FOUND");
        if (!recordHtmlEditingJournalReceipt(input.storage, scope, operationId, result.receipt)) throw new HtmlEditingRecoveryError("UNVERIFIED");
        const recorded = readHtmlEditingJournal(input.storage, scope);
        if (recorded.status !== "PENDING" || recorded.entry.operationId !== operationId
          || JSON.stringify(recorded.entry.receipt) !== JSON.stringify(result.receipt)) throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
        entry = recorded.entry;
      }
      const ack = entry.acknowledgment;
      if (!ack) throw new HtmlEditingRecoveryError("ACK_REQUIRED");
      signal.throwIfAborted();
      if (!input.isCurrent()) throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
      const payload = await boundedWait(() => readHtmlEditingNativePayload(scope, signal, input.fetcher), signal);
      const view = input.historicalOnly ? null : await boundedWait(() => consultHtmlEditingInspector({ scope: { organizationId: scope.organizationId, documentId: scope.draftId, clipId: entry.clipId }, signal, fetcher: input.fetcher }), signal);
      if (payload.documentHash !== input.loaded.documentHash || payload.version !== input.loaded.version
        || await hashCompositionDocumentInBrowser(input.loaded.document) !== input.loaded.documentHash) {
        throw new HtmlEditingRecoveryError("RELOAD_REQUIRED");
      }
      if (input.historicalOnly) {
        if (await hashCompositionDocumentInBrowser(payload.document) !== payload.documentHash) throw new HtmlEditingRecoveryError("UNVERIFIED");
        signal.throwIfAborted();
        const latest = readHtmlEditingJournal(input.storage, scope);
        if (!input.isCurrent() || latest.status !== "PENDING" || JSON.stringify(latest.entry) !== JSON.stringify(entry)
          || !closeHistoricallyConfirmedHtmlEditingJournal(input.storage, scope, entry)) {
          throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
        }
        return;
      }
      if (!view) throw new HtmlEditingRecoveryError("UNVERIFIED");
      const binding = view.manifest.binding;
      const reference = payload.document.htmlEditing?.items.find(item => item.clipId === entry.clipId);
      const clip = payload.document.clips.find(item => item.id === entry.clipId);
      if (view.compositionDocumentHash !== payload.documentHash || binding.organizationId !== scope.organizationId
        || binding.documentId !== scope.draftId || binding.clipId !== entry.clipId
        || view.revisionVersion !== ack.next.version || view.revisionSha256 !== ack.next.sha256
        || await hashCompositionDocumentInBrowser(payload.document) !== payload.documentHash
        || !clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE") throw new HtmlEditingRecoveryError("UNVERIFIED");
      if (reference ? reference.revisionVersion !== ack.next.version || reference.revisionSha256 !== ack.next.sha256
        || reference.templateId !== binding.templateId || reference.templateVersion !== binding.templateVersion
        || reference.sourceSha256 !== binding.sourceSha256 || reference.manifestSha256 !== binding.manifestSha256
        : ack.changed || ack.next.version !== 1 || payload.documentHash !== entry.expectedCompositionDocumentHash) {
        throw new HtmlEditingRecoveryError("UNVERIFIED");
      }
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clip.source.html));
      const sourceSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (sourceSha256 !== binding.sourceSha256) throw new HtmlEditingRecoveryError("UNVERIFIED");
      signal.throwIfAborted();
      const latest = readHtmlEditingJournal(input.storage, scope);
      if (!input.isCurrent() || latest.status !== "PENDING" || JSON.stringify(latest.entry) !== JSON.stringify(entry)) {
        throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
      }
      if (!closeRebasedHtmlEditingJournal(input.storage, scope, operationId, ack.next)) throw new HtmlEditingRecoveryError("TRACKING_CHANGED");
    })), signal);
  } catch (error) {
    if (error instanceof HtmlEditingRecoveryError) throw error;
    throw new HtmlEditingRecoveryError("UNVERIFIED");
  }
}
