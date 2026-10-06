import { htmlSnapshotLocatorScopeSchema, readHtmlSnapshotTrackingAvailability, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { readHtmlEditingJournal, type HtmlEditingJournalState } from "./composition-html-editing-journal.client";
import { recoverAcknowledgedHtmlEditingOperation } from "./composition-html-editing-recovery.client";
import { dispatchTrackedHtmlEditingMutation } from "./composition-html-editing-dispatch.client";
import { readHtmlEditingRebaseCandidate, type HtmlEditingNativePayload } from "./composition-html-editing-rebase.client";
import { htmlEditingInspectorViewSchema, type HtmlEditingInspectorView } from "./html-editing/html-editing-inspector.contract";
import { htmlEditingMutationRequestSchema, type HtmlEditingMutationRequest } from "./composition-html-editing-mutation.contract";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { readHtmlEditingInitializationJournal, type HtmlEditingInitializationJournalState } from "./composition-html-editing-initialization-journal.client";
import { coordinateHtmlEditingInitialization, type HtmlEditingInitializationAction } from "./composition-html-editing-initialization-coordinator.client";

export interface CompositionHtmlEditorialHost {
  initializationTracking?: (scope: HtmlSnapshotLocatorScope) => HtmlEditingInitializationJournalState;
  initialize?: (input: { scope: HtmlSnapshotLocatorScope; action: HtmlEditingInitializationAction; signal: AbortSignal }) => Promise<HtmlEditingInspectorView>;
  tracking?: (scope: HtmlSnapshotLocatorScope) => HtmlEditingJournalState;
  recover?: (input: { scope: HtmlSnapshotLocatorScope; operationId: string; signal: AbortSignal; historicalOnly?: boolean }) => Promise<void>;
  execute(input: { scope: HtmlSnapshotLocatorScope; clipId: string; body: HtmlEditingMutationRequest;
    beforeView: HtmlEditingInspectorView; signal: AbortSignal }): Promise<{
    acknowledgment: unknown; view: unknown; adoptedDocumentHash: string;
  }>;
}
interface NativeHostPorts {
  enabled: () => boolean;
  durableEnabled?: () => boolean;
  initializationEnabled?: () => boolean;
  getScope: () => HtmlSnapshotLocatorScope | null;
  getPayload: () => HtmlEditingNativePayload | null;
  hasConflictingWork: (reserved: boolean) => boolean;
  reserve: <T>(task: () => Promise<T>) => Promise<T>;
  getStorage: () => HtmlSnapshotLocatorStorage | null;
  getLock: () => HtmlSnapshotPublicationLock | null;
  adopt: (payload: HtmlEditingNativePayload) => void;
  onBusyChange: (busy: boolean) => void;
  fetcher?: typeof fetch;
  createOperationId?: () => string;
}

/** Native UI adapter only. Permissions and CAS remain server-side. Native callers
 * must honor isBlocked() for bypass writes and expose synchronous pending work. */
export class CompositionHtmlEditorialNativeHost implements CompositionHtmlEditorialHost {
  private active: AbortController | null = null;
  constructor(private readonly ports: NativeHostPorts) {}
  isBusy() { return this.active !== null; }
  abortPending() { this.active?.abort(); }
  initializationTracking(scope: HtmlSnapshotLocatorScope): HtmlEditingInitializationJournalState {
    if (!sameScope(scope, this.ports.getScope())) return { status: "UNAVAILABLE" };
    return readHtmlEditingInitializationJournal(this.ports.getStorage(), scope);
  }
  async initialize(input: { scope: HtmlSnapshotLocatorScope; action: HtmlEditingInitializationAction; signal: AbortSignal }) {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), base = this.ports.getPayload();
    if (this.active || !base || input.signal.aborted || !sameScope(scope, this.ports.getScope())
      || (input.action.mode === "SEND" && this.ports.initializationEnabled?.() !== true)
      || this.ports.hasConflictingWork(false) || readHtmlEditingJournal(this.ports.getStorage(), scope).status !== "EMPTY"
      || readHtmlSnapshotTrackingAvailability(this.ports.getStorage(), scope) !== "EMPTY") throw new Error("HTML_EDITING_INITIALIZATION_NOT_READY");
    const controller = new AbortController(); this.active = controller;
    const signal = AbortSignal.any([controller.signal, input.signal]);
    const current = () => !signal.aborted && sameScope(scope, this.ports.getScope()) && this.ports.getPayload() === base
      && !this.ports.hasConflictingWork(true) && readHtmlEditingJournal(this.ports.getStorage(), scope).status === "EMPTY"
      && readHtmlSnapshotTrackingAvailability(this.ports.getStorage(), scope) === "EMPTY";
    try {
      this.ports.onBusyChange(true);
      return await coordinateHtmlEditingInitialization({ ...input, scope, signal, loaded: base,
        storage: this.ports.getStorage(), lock: this.ports.getLock(), reserveNative: task => this.ports.reserve(task),
        isCurrent: current, fetcher: this.ports.fetcher, createOperationId: this.ports.createOperationId });
    } finally {
      if (this.active === controller) { this.active = null; this.ports.onBusyChange(false); }
    }
  }
  tracking(scope: HtmlSnapshotLocatorScope): HtmlEditingJournalState {
    if (!sameScope(scope, this.ports.getScope())) return { status: "UNAVAILABLE" };
    return readHtmlEditingJournal(this.ports.getStorage(), scope);
  }
  async recover(input: { scope: HtmlSnapshotLocatorScope; operationId: string; signal: AbortSignal; historicalOnly?: boolean }) {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), base = this.ports.getPayload();
    if (this.active || !base || input.signal.aborted || !sameScope(scope, this.ports.getScope())
      || this.ports.hasConflictingWork(false)
      || readHtmlEditingInitializationJournal(this.ports.getStorage(), scope).status !== "EMPTY"
      || readHtmlSnapshotTrackingAvailability(this.ports.getStorage(), scope) !== "EMPTY") throw new Error("HTML_EDITING_RECOVERY_NOT_READY");
    const controller = new AbortController(); this.active = controller;
    const signal = AbortSignal.any([controller.signal, input.signal]);
    const current = () => !signal.aborted && sameScope(scope, this.ports.getScope()) && this.ports.getPayload() === base
      && !this.ports.hasConflictingWork(true) && readHtmlSnapshotTrackingAvailability(this.ports.getStorage(), scope) === "EMPTY"
      && readHtmlEditingInitializationJournal(this.ports.getStorage(), scope).status === "EMPTY";
    try {
      this.ports.onBusyChange(true);
      await recoverAcknowledgedHtmlEditingOperation({ ...input, scope, signal, loaded: base,
        storage: this.ports.getStorage(), lock: this.ports.getLock(), reserveNative: task => this.ports.reserve(task),
        isCurrent: current, fetcher: this.ports.fetcher });
    } finally {
      if (this.active === controller) { this.active = null; this.ports.onBusyChange(false); }
    }
  }
  isBlocked() {
    if (this.active) return true;
    const scope = this.ports.getScope();
    const storage = this.ports.getStorage();
    if (!scope || !storage) return this.ports.enabled() || this.ports.initializationEnabled?.() === true;
    // Disabling new writes cannot erase an already persisted pending operation.
    return readHtmlEditingJournal(storage, scope).status !== "EMPTY" || readHtmlEditingInitializationJournal(storage, scope).status !== "EMPTY";
  }
  async execute(input: Parameters<CompositionHtmlEditorialHost["execute"]>[0]) {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope);
    const body = htmlEditingMutationRequestSchema.parse(input.body);
    const beforeView = htmlEditingInspectorViewSchema.parse(input.beforeView);
    const base = this.ports.getPayload();
    const binding = beforeView.manifest.binding;
    if (!this.ports.enabled() || this.isBlocked() || readHtmlSnapshotTrackingAvailability(this.ports.getStorage(), scope) !== "EMPTY"
      || input.signal.aborted || !base || this.ports.hasConflictingWork(false)
      || !sameScope(scope, this.ports.getScope()) || binding.organizationId !== scope.organizationId
      || binding.documentId !== scope.draftId || binding.clipId !== input.clipId
      || base.documentHash !== body.expectedCompositionDocumentHash || beforeView.compositionDocumentHash !== base.documentHash
      || beforeView.revisionVersion !== body.expected.version || beforeView.revisionSha256 !== body.expected.sha256) {
      throw new Error("HTML_EDITING_NATIVE_NOT_READY");
    }
    const controller = new AbortController(); this.active = controller;
    const signal = AbortSignal.any([controller.signal, input.signal]);
    let adopted: HtmlEditingNativePayload | null = null, refreshedView: HtmlEditingInspectorView | null = null;
    const current = () => !signal.aborted && sameScope(scope, this.ports.getScope())
      && this.ports.getPayload() === (adopted ?? base) && !this.ports.hasConflictingWork(true)
      && readHtmlSnapshotTrackingAvailability(this.ports.getStorage(), scope) === "EMPTY"
      && readHtmlEditingInitializationJournal(this.ports.getStorage(), scope).status === "EMPTY";
    try {
      this.ports.onBusyChange(true);
      const acknowledgment = await dispatchTrackedHtmlEditingMutation({ scope, clipId: input.clipId, body, signal,
        durable: this.ports.durableEnabled?.() === true,
        storage: this.ports.getStorage(), lock: this.ports.getLock(), fetcher: this.ports.fetcher, createOperationId: this.ports.createOperationId,
        reserveNative: task => this.ports.reserve(task), isCurrentAndEditable: current,
        rebase: async (ack, rebaseSignal) => {
          const result = await readHtmlEditingRebaseCandidate({ scope, clipId: input.clipId, base, beforeView,
            acknowledgment: ack, signal: rebaseSignal, fetcher: this.ports.fetcher });
          rebaseSignal.throwIfAborted(); if (!current()) return false;
          if (ack.changed) this.ports.adopt(result.payload);
          adopted = ack.changed ? result.payload : base; refreshedView = result.view;
          return current();
        } });
      if (!adopted || !refreshedView || !current()) throw new Error("HTML_EDITING_NATIVE_REFRESH_REQUIRED");
      return { acknowledgment, view: refreshedView, adoptedDocumentHash: (adopted as HtmlEditingNativePayload).documentHash };
    } finally {
      if (this.active === controller) { this.active = null; this.ports.onBusyChange(false); }
    }
  }
}
function sameScope(left: HtmlSnapshotLocatorScope, right: HtmlSnapshotLocatorScope | null) {
  return right !== null && left.actorId === right.actorId && left.organizationId === right.organizationId && left.draftId === right.draftId;
}
