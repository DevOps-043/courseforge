import { NarrativeExtractionController } from "./composition-narrative-extraction-controller";
import { NarrativeFragmentController } from "./composition-narrative-fragment-controller";
import type { NarrativeExtractionSessionState } from "./composition-narrative-extraction-session";
import type { NarrativeFragmentSessionState } from "./composition-narrative-fragment-session";
import type { NarrativeExtractionQuery, NarrativeExtractionSummary } from "./composition-narrative-extraction-contract";
import type { NarrativeFragmentQuery, NarrativeFragmentSummary } from "./composition-narrative-fragment-contract";
import { readNarrativeCommandPending, type NarrativeExtractionPendingScope, type NarrativeExtractionPendingStorage } from "./composition-narrative-extraction-pending";
import type { NarrativeExtractionExclusiveLock } from "./composition-narrative-command-controller";

export type NarrativeEditorSessionState = NarrativeExtractionSessionState | NarrativeFragmentSessionState;
export type NarrativeEditorReload = { newClipIds: string[]; anchorClipId: string; documentHash: string; kind: "VOICE" | "AUDIOVISUAL" };
type Dependencies = { scope: NarrativeExtractionPendingScope; storage: NarrativeExtractionPendingStorage;
  exclusiveLock: NarrativeExtractionExclusiveLock; fetcher?: typeof fetch;
  onState: (state: NarrativeEditorSessionState) => void; reloadDocument: (receipt: NarrativeEditorReload) => Promise<boolean> };

/** Exactly one active command owner per editor. Switching policies never discards an in-flight command. */
export class NarrativeEditorController {
  private active: NarrativeExtractionController | NarrativeFragmentController;
  private working = false;
  constructor(private readonly dependencies: Dependencies) {
    const pending = readNarrativeCommandPending(dependencies.storage, dependencies.scope);
    this.active = this.create(pending.status === "PENDING" && pending.command.contract === "NARRATIVE_FRAGMENT_APPLY_V1" ? "AUDIOVISUAL" : "VOICE");
  }
  private create(kind: "VOICE" | "AUDIOVISUAL") {
    const shared = { ...this.dependencies, onState: this.dependencies.onState };
    return kind === "VOICE" ? new NarrativeExtractionController({ ...shared,
      reloadDocument: (anchorClipId, documentHash) => this.dependencies.reloadDocument({
        newClipIds: [anchorClipId], anchorClipId, documentHash, kind }) })
      : new NarrativeFragmentController({ ...shared,
        reloadDocument: (newClipIds, anchorClipId, documentHash) => this.dependencies.reloadDocument({
          newClipIds, anchorClipId, documentHash, kind }) });
  }
  initialize() { this.active.initialize(); }
  get state(): NarrativeEditorSessionState { return this.active.state; }
  get unavailable() { return this.active.unavailable; }
  get isBusy() { return this.working || !["IDLE", "REVIEWED"].includes(this.state.phase); }
  private select(kind: "VOICE" | "AUDIOVISUAL"): boolean {
    if (this.working || this.active.unavailable || !["IDLE", "REVIEWED"].includes(this.active.state.phase)) return false;
    const matching = kind === "VOICE" ? this.active instanceof NarrativeExtractionController : this.active instanceof NarrativeFragmentController;
    if (!matching) { this.active = this.create(kind); this.active.initialize(); }
    return !this.active.unavailable && ["IDLE", "REVIEWED"].includes(this.active.state.phase);
  }
  review(selection: NarrativeExtractionQuery, summary: NarrativeExtractionSummary): boolean {
    return this.select("VOICE") && this.active instanceof NarrativeExtractionController && this.active.review(selection, summary);
  }
  reviewFragment(query: NarrativeFragmentQuery, summary: NarrativeFragmentSummary): boolean {
    return this.select("AUDIOVISUAL") && this.active instanceof NarrativeFragmentController && this.active.review(query, summary);
  }
  private async run(task: () => Promise<boolean>) {
    if (this.working) return false;
    this.working = true;
    try { return await task(); } finally { this.working = false; }
  }
  apply(selection: NarrativeExtractionQuery, signal: AbortSignal) {
    return this.run(() => this.active instanceof NarrativeExtractionController ? this.active.apply(selection, signal) : Promise.resolve(false));
  }
  applyFragment(query: NarrativeFragmentQuery, signal: AbortSignal) {
    return this.run(() => this.active instanceof NarrativeFragmentController ? this.active.apply(query, signal) : Promise.resolve(false));
  }
  recover(signal: AbortSignal) { return this.run(() => this.active.recover(signal)); }
  reload() { return this.run(() => this.active.reload()); }
}
