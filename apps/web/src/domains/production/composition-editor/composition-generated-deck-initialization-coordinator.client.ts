import { z } from "zod";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { htmlEditingReferenceSchema, HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT } from "./html-editing/html-editing-reference.contract";
import { hashCompositionDocumentInBrowser } from "./composition-recovery-journal";
import { readHtmlEditingNativePayload, type HtmlEditingNativePayload } from "./composition-html-editing-rebase.client";
import { boundedWait } from "./composition-html-editing-dispatch.client";
import { requestHtmlInitialAnchor } from "./composition-html-initial-anchor.client";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { GENERATED_DECK_INITIALIZATION_POLICY, type GeneratedDeckInitializationCurrent, type GeneratedDeckInitializationReceipt } from "./composition-generated-deck-initialization.contract";
import { beginGeneratedDeckInitializationJournal, readGeneratedDeckInitializationJournal, recordGeneratedDeckInitializationReceipt,
  closeVerifiedGeneratedDeckInitializationJournal, type GeneratedDeckInitializationJournalEntry } from "./composition-generated-deck-initialization-journal.client";
import { computeGeneratedDeckInitializationRequestSha256InBrowser, sendGeneratedDeckInitialization,
  consultGeneratedDeckInitialization, consultCurrentGeneratedDeckInitialization } from "./composition-generated-deck-initialization.client";

export type GeneratedDeckInitializationAction = { mode: "SEND" }
  | { mode: "RECOVER"; operationId: string; historicalOnly?: boolean };
export class GeneratedDeckInitializationCoordinatorError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_READY" | "ANCHOR_REQUIRED" | "TRACKING_CHANGED" | "ACK_REQUIRED" | "OUTCOME_UNKNOWN" | "REFRESH_REQUIRED" | "UNVERIFIED") {
    super(`GENERATED_DECK_INITIALIZATION_${code}`); this.name = "GeneratedDeckInitializationCoordinatorError";
  }
}

/** Verify preserved native content independently. After reload the original
 * document may be unavailable: only the exact acknowledged current payload is
 * acceptable, never an unrelated newer document or a stale historical one. */
export async function verifyGeneratedDeckInitializationRebase(input: {
  loaded: HtmlEditingNativePayload; candidate: HtmlEditingNativePayload; receipt: GeneratedDeckInitializationReceipt; signal: AbortSignal;
}) {
  const { loaded, candidate, receipt, signal } = input;
  signal.throwIfAborted();
  if (await hashCompositionDocumentInBrowser(loaded.document) !== loaded.documentHash
    || await hashCompositionDocumentInBrowser(candidate.document) !== candidate.documentHash
    || candidate.documentHash !== receipt.documentHash || candidate.version !== receipt.documentVersion)
    throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
  const references = receipt.items.map(item => htmlEditingReferenceSchema.strip().parse(item));
  for (const reference of references) {
    const clip = candidate.document.clips.find(item => item.id === reference.clipId);
    if (!clip || clip.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE" || clip.source.htmlAssetId
      || JSON.stringify(candidate.document.htmlEditing?.items.find(item => item.clipId === clip.id)) !== JSON.stringify(reference))
      throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clip.source.html));
    if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("") !== reference.sourceSha256)
      throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
  }
  if (loaded.documentHash === receipt.expectedDocumentHash) {
    const bound = new Set(loaded.document.htmlEditing?.items.map(item => item.clipId) ?? []);
    const pendingIds = loaded.document.clips.filter(clip => clip.kind === "DECK_SLIDE" && !bound.has(clip.id)).map(clip => clip.id).sort();
    if (JSON.stringify(pendingIds) !== JSON.stringify(references.map(item => item.clipId)) || candidate.version !== loaded.version + 1)
      throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
    const expected = compositionEditorDocumentSchema.parse({ ...loaded.document, format: HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT,
      htmlEditing: { format: "courseforge-html-editable-references-v1", items: [...(loaded.document.htmlEditing?.items ?? []), ...references]
        .sort((left, right) => left.clipId < right.clipId ? -1 : left.clipId > right.clipId ? 1 : 0) } });
    if (await hashCompositionDocumentInBrowser(expected) !== candidate.documentHash) throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
  } else if (loaded.documentHash !== receipt.documentHash || loaded.version !== receipt.documentVersion) {
    throw new GeneratedDeckInitializationCoordinatorError("REFRESH_REQUIRED");
  }
  signal.throwIfAborted(); return candidate;
}

/** One lock/reservation spans preflight, durable intent, POST, readback and
 * adoption. Recovery never POSTs. Availability/NOT_FOUND cannot authorize retry. */
export async function coordinateGeneratedDeckInitialization(input: {
  scope: HtmlSnapshotLocatorScope; action: GeneratedDeckInitializationAction; loaded: HtmlEditingNativePayload;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  reserveNative: <T>(task: () => Promise<T>) => Promise<T>; isCurrent: () => boolean; signal: AbortSignal;
  acceptVerified: (result: { payload: HtmlEditingNativePayload; current: GeneratedDeckInitializationCurrent | null }, signal: AbortSignal) => Promise<void>;
  onAnchorAvailable?: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>;
  fetcher?: typeof fetch; createOperationId?: () => string;
}): Promise<GeneratedDeckInitializationCurrent | null> {
  let dispatched = false, confirmed = false;
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), storage = input.storage, lock = input.lock;
    if (!storage || !lock || input.signal.aborted) throw new GeneratedDeckInitializationCoordinatorError("NOT_READY");
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(GENERATED_DECK_INITIALIZATION_POLICY.timeoutMs)]);
    return await boundedWait(() => lock.runExclusive(scope, () => input.reserveNative(async () => {
      const guard = () => { signal.throwIfAborted(); if (!input.isCurrent()) throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED"); };
      guard();
      let entry: GeneratedDeckInitializationJournalEntry;
      if (input.action.mode === "SEND") {
        const bound = new Set(input.loaded.document.htmlEditing?.items.map(item => item.clipId) ?? []);
        const clips = input.loaded.document.clips.filter(clip => clip.kind === "DECK_SLIDE" && !bound.has(clip.id));
        if (!clips.length || clips.length + bound.size > GENERATED_DECK_INITIALIZATION_POLICY.maximumClips
          || clips.some(clip => clip.source.type !== "DECK_SLIDE" || clip.source.htmlAssetId)
          || readGeneratedDeckInitializationJournal(storage, scope).status !== "EMPTY"
          || await hashCompositionDocumentInBrowser(input.loaded.document) !== input.loaded.documentHash)
          throw new GeneratedDeckInitializationCoordinatorError("NOT_READY");
        guard();
        let anchor = await requestHtmlInitialAnchor({ documentId: scope.draftId, expectedDocumentHash: input.loaded.documentHash,
          action: "CONSULT", signal, fetcher: input.fetcher });
        guard();
        if (!anchor.activeRevisionId) {
          // This explicitly authorized SEND includes the real first snapshot.
          // No mount/GET registers or activates; no failed PREPARE is retried.
          anchor = await requestHtmlInitialAnchor({ documentId: scope.draftId, expectedDocumentHash: input.loaded.documentHash,
            action: "PREPARE", signal, fetcher: input.fetcher });
          guard();
        }
        if (!anchor.activeRevisionId) throw new GeneratedDeckInitializationCoordinatorError("ANCHOR_REQUIRED");
        await input.onAnchorAvailable?.(signal, input.isCurrent); guard();
        const request = { operationId: z.string().uuid().parse((input.createOperationId ?? (() => crypto.randomUUID()))()),
          expectedDocumentHash: input.loaded.documentHash,
          requestSha256: await computeGeneratedDeckInitializationRequestSha256InBrowser(input.loaded.documentHash) };
        guard();
        if (!beginGeneratedDeckInitializationJournal(storage, { scope, request, createdAt: Date.now() })) throw new GeneratedDeckInitializationCoordinatorError("NOT_READY");
        const pending = readGeneratedDeckInitializationJournal(storage, scope);
        if (pending.status !== "PENDING" || pending.entry.request.operationId !== request.operationId) throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry; guard(); dispatched = true;
        const receipt = await boundedWait(() => sendGeneratedDeckInitialization({ scope, body: request, signal, fetcher: input.fetcher }), signal);
        guard();
        if (!recordGeneratedDeckInitializationReceipt(storage, scope, entry, receipt)) throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
      } else {
        const pending = readGeneratedDeckInitializationJournal(storage, scope);
        if (pending.status !== "PENDING" || pending.entry.request.operationId !== input.action.operationId)
          throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
        entry = pending.entry;
        const request = entry.request;
        if (await computeGeneratedDeckInitializationRequestSha256InBrowser(request.expectedDocumentHash) !== request.requestSha256)
          throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
        guard();
        const read = await boundedWait(() => consultGeneratedDeckInitialization({ scope,
          identity: { operationId: request.operationId, requestSha256: request.requestSha256 }, signal, fetcher: input.fetcher }), signal);
        guard();
        if (read.status !== "RECORDED") throw new GeneratedDeckInitializationCoordinatorError("ACK_REQUIRED");
        if (!recordGeneratedDeckInitializationReceipt(storage, scope, entry, read.receipt)) throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
      }
      const recorded = readGeneratedDeckInitializationJournal(storage, scope);
      if (recorded.status !== "PENDING" || !recorded.entry.receipt
        || recorded.entry.request.operationId !== entry.request.operationId) throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
      entry = recorded.entry; confirmed = true; guard();
      const receipt = entry.receipt!, identity = { operationId: entry.request.operationId, requestSha256: entry.request.requestSha256 };
      const candidate = await boundedWait(() => readHtmlEditingNativePayload(scope, signal, input.fetcher), signal);
      const historicalOnly = input.action.mode === "RECOVER" && input.action.historicalOnly === true;
      let current: GeneratedDeckInitializationCurrent | null = null;
      if (historicalOnly) {
        if (candidate.documentHash !== input.loaded.documentHash || candidate.version !== input.loaded.version
          || await hashCompositionDocumentInBrowser(candidate.document) !== candidate.documentHash
          || await hashCompositionDocumentInBrowser(input.loaded.document) !== input.loaded.documentHash)
          throw new GeneratedDeckInitializationCoordinatorError("REFRESH_REQUIRED");
      } else {
        await verifyGeneratedDeckInitializationRebase({ loaded: input.loaded, candidate, receipt, signal });
        current = await boundedWait(() => consultCurrentGeneratedDeckInitialization({ scope, identity,
          documentHash: candidate.documentHash, signal, fetcher: input.fetcher }), signal);
        if (JSON.stringify(current.receipt) !== JSON.stringify(receipt)) throw new GeneratedDeckInitializationCoordinatorError("UNVERIFIED");
      }
      guard();
      const beforeAdoption = readGeneratedDeckInitializationJournal(storage, scope);
      if (beforeAdoption.status !== "PENDING" || JSON.stringify(beforeAdoption.entry) !== JSON.stringify(entry))
        throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
      await input.acceptVerified({ payload: candidate, current }, signal);
      guard();
      if (!closeVerifiedGeneratedDeckInitializationJournal(storage, scope, entry)) throw new GeneratedDeckInitializationCoordinatorError("TRACKING_CHANGED");
      return current;
    })), signal);
  } catch (error) {
    if (error instanceof GeneratedDeckInitializationCoordinatorError) throw error;
    throw new GeneratedDeckInitializationCoordinatorError(confirmed ? "REFRESH_REQUIRED" : dispatched ? "OUTCOME_UNKNOWN" : "NOT_READY");
  }
}
