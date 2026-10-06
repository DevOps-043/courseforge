import type { z } from "zod";
import { NarrativeCommandSession, type NarrativeCommandResponse, type NarrativeCommandSessionState } from "./composition-narrative-command-session";
import { NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS } from "./composition-narrative-extraction-contract";
import { readNarrativeCommandPending, reserveNarrativeCommandPending, clearNarrativeCommandPending, narrativeExtractionPendingKey,
  type NarrativePendingCommand, type NarrativeExtractionPendingScope, type NarrativeExtractionPendingStorage } from "./composition-narrative-extraction-pending";

export type NarrativeExtractionExclusiveLock = <T>(name: string, task: () => Promise<T>) => Promise<T>;
export type NarrativeCommandControllerDependencies<C extends NarrativePendingCommand, Q, S,
  R extends { commandId: string; status: "COMMITTED" | "REPLAYED" | "CONFIRMED" }> = {
  storage: NarrativeExtractionPendingStorage; scope: NarrativeExtractionPendingScope;
  exclusiveLock: NarrativeExtractionExclusiveLock; fetcher?: typeof fetch;
  onState: (state: NarrativeCommandSessionState<C, S, R>) => void;
  session: NarrativeCommandSession<C, Q, S, R>; commandSchema: z.ZodType<C>;
  dispatch: (parameters: { mode: "APPLY" | "RECOVERY"; draftId: string; command: C;
    signal: AbortSignal; fetcher?: typeof fetch }) => Promise<NarrativeCommandResponse<R>>;
  reloadDocument: (receipt: R) => Promise<boolean>;
};

/** Browser lock serializes cooperating tabs; server receipt/OCC remains the authority across devices. */
export class NarrativeCommandController<C extends NarrativePendingCommand, Q, S, R extends { commandId: string; status: "COMMITTED" | "REPLAYED" | "CONFIRMED" }> {
  private busy = false;
  private blocked = false;
  constructor(private readonly dependencies: NarrativeCommandControllerDependencies<C, Q, S, R>) {}
  private get session() { return this.dependencies.session; }
  get state() { return this.session.state; }
  get unavailable() { return this.blocked; }
  private publish() { this.dependencies.onState(this.state); }

  private readPending(): { status: "EMPTY" | "UNAVAILABLE" } | { status: "PENDING"; command: C } {
    const pending = readNarrativeCommandPending(this.dependencies.storage, this.dependencies.scope);
    if (pending.status !== "PENDING") return pending;
    const parsed = this.dependencies.commandSchema.safeParse(pending.command);
    return parsed.success ? { status: "PENDING", command: parsed.data } : { status: "UNAVAILABLE" };
  }

  initialize(): void {
    const pending = this.readPending();
    this.blocked = pending.status === "UNAVAILABLE";
    if (pending.status === "PENDING") this.session.restorePending(this.dependencies.scope.draftId, pending.command);
    this.publish();
  }
  review(selection: Q, summary: S): boolean {
    if (this.blocked || this.busy) return false;
    const accepted = this.session.review(this.dependencies.scope.draftId, selection, summary);
    this.publish(); return accepted;
  }
  invalidateReview(): void { this.session.invalidateReview(); this.publish(); }

  async apply(selection: Q, signal: AbortSignal): Promise<boolean> {
    if (this.busy || this.blocked) return false;
    this.busy = true;
    try {
      return await this.dependencies.exclusiveLock(narrativeExtractionPendingKey(this.dependencies.scope), async () => {
        signal.throwIfAborted();
        const pending = this.readPending();
        if (pending.status !== "EMPTY") {
          this.session.invalidateReview();
          if (pending.status === "PENDING") this.session.restorePending(this.dependencies.scope.draftId, pending.command);
          else this.blocked = true;
          this.publish(); return false;
        }
        const command = this.session.beginApply(this.dependencies.scope.draftId, selection, crypto.randomUUID());
        if (!command) return false;
        if (!reserveNarrativeCommandPending(this.dependencies.storage, this.dependencies.scope, command)) {
          this.blocked = true;
          this.session.settle({ kind: "UNCONFIRMED", commandId: command.commandId, message: "No se envió el comando: recuperación local no disponible." });
          this.publish(); return false;
        }
        this.publish();
        // No awaited step between reservation and dispatch. Record remains if acknowledgement is lost.
        const result = await this.dependencies.dispatch({ mode: "APPLY", draftId: this.dependencies.scope.draftId,
          command, signal: AbortSignal.any([signal, AbortSignal.timeout(NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS)]), fetcher: this.dependencies.fetcher });
        if (result.kind === "REJECTED" && !clearNarrativeCommandPending(this.dependencies.storage, this.dependencies.scope, command)) {
          this.blocked = true;
          this.session.settle({ kind: "UNCONFIRMED", commandId: command.commandId, message: "No se pudo limpiar el registro rechazado." });
        } else this.session.settle(result);
        this.publish();
        return result.kind === "CONFIRMED";
      });
    } catch {
      const state = this.state;
      if (state.phase === "APPLYING") this.session.settle({ kind: "UNCONFIRMED", commandId: state.command.commandId, message: "Resultado no confirmado." });
      this.publish(); return false;
    } finally { this.busy = false; }
  }

  async recover(signal: AbortSignal): Promise<boolean> {
    if (this.busy || this.blocked) return false;
    this.busy = true;
    try {
      return await this.dependencies.exclusiveLock(narrativeExtractionPendingKey(this.dependencies.scope), async () => {
        signal.throwIfAborted();
        const pending = this.session.beginRecovery();
        if (!pending) return false;
        this.publish();
        const result = await this.dependencies.dispatch({ mode: "RECOVERY", ...pending,
          signal: AbortSignal.any([signal, AbortSignal.timeout(NARRATIVE_EXTRACTION_QUERY_TIMEOUT_MS)]), fetcher: this.dependencies.fetcher });
        this.session.settle(result); this.publish(); return result.kind === "CONFIRMED";
      });
    } catch {
      const state = this.state;
      if (state.phase === "RECOVERING") this.session.settle({ kind: "UNCONFIRMED", commandId: state.command.commandId, message: "Resultado no confirmado." });
      this.publish(); return false;
    } finally { this.busy = false; }
  }

  async reload(): Promise<boolean> {
    if (this.busy || this.blocked || this.state.phase !== "RELOAD_REQUIRED") return false;
    this.busy = true;
    try {
      return await this.dependencies.exclusiveLock(narrativeExtractionPendingKey(this.dependencies.scope), async () => {
        const state = this.state;
        if (state.phase !== "RELOAD_REQUIRED" || !await this.dependencies.reloadDocument(state.receipt)) return false;
        if (!clearNarrativeCommandPending(this.dependencies.storage, this.dependencies.scope, state.command)) {
          this.blocked = true; this.publish(); return false;
        }
        this.session.acknowledgeReload(state.draftId); this.publish(); return true;
      });
    } catch { return false; } finally { this.busy = false; }
  }
}
