import { z } from "zod";

export type NarrativeCommandResponse<R> =
  | { kind: "CONFIRMED"; receipt: R }
  | { kind: "REJECTED" | "UNCONFIRMED"; commandId: string; message: string };
export type NarrativeCommandSessionState<C, S, R> =
  | { phase: "IDLE" }
  | { phase: "REVIEWED"; selectionKey: string; summary: S }
  | { phase: "APPLYING" | "UNCONFIRMED" | "RECOVERING"; draftId: string; command: C }
  | { phase: "RELOAD_REQUIRED"; draftId: string; command: C; receipt: R };
type CommandIdentity = { commandId: string };
type ReceiptIdentity = CommandIdentity & { status: "COMMITTED" | "REPLAYED" | "CONFIRMED" };
type Policy<C, Q, S, R> = {
  commandSchema: z.ZodType<C>;
  selectionKey: (draftId: string, query: Q) => string | null;
  validateReview: (query: Q, summary: S) => S | null;
  createCommand: (query: Q, summary: S, commandId: string) => C;
  validateReceipt: (receipt: R) => boolean;
};

/** One lifecycle for all narrative commands; domain policies own review and receipt contracts. */
export class NarrativeCommandSession<C extends CommandIdentity, Q, S, R extends ReceiptIdentity> {
  private current: NarrativeCommandSessionState<C, S, R> = { phase: "IDLE" };
  constructor(private readonly policy: Policy<C, Q, S, R>) {}
  get state(): NarrativeCommandSessionState<C, S, R> { return structuredClone(this.current); }
  review(draftId: string, query: Q, summary: S): boolean {
    if (this.current.phase !== "IDLE" && this.current.phase !== "REVIEWED") return false;
    const selectionKey = this.policy.selectionKey(draftId, query);
    const validated = this.policy.validateReview(query, summary);
    if (!selectionKey || !validated) return false;
    this.current = { phase: "REVIEWED", selectionKey, summary: structuredClone(validated) };
    return true;
  }
  invalidateReview(): void {
    if (this.current.phase === "REVIEWED") this.current = { phase: "IDLE" };
  }
  /** Reloaded pointers permit receipt queries only, never another apply. */
  restorePending(draftId: string, command: C): boolean {
    if (this.current.phase !== "IDLE" || !z.string().uuid().safeParse(draftId).success) return false;
    const parsed = this.policy.commandSchema.safeParse(command);
    if (!parsed.success) return false;
    this.current = { phase: "UNCONFIRMED", draftId, command: structuredClone(parsed.data) };
    return true;
  }
  beginApply(draftId: string, query: Q, commandId: string): C | null {
    if (this.current.phase !== "REVIEWED"
      || this.current.selectionKey !== this.policy.selectionKey(draftId, query)) return null;
    const command = this.policy.commandSchema.parse(this.policy.createCommand(query, this.current.summary, commandId));
    this.current = { phase: "APPLYING", draftId, command: structuredClone(command) };
    return structuredClone(command);
  }
  beginRecovery(): { draftId: string; command: C } | null {
    if (this.current.phase !== "UNCONFIRMED") return null;
    this.current = { ...this.current, phase: "RECOVERING" };
    return { draftId: this.current.draftId, command: structuredClone(this.current.command) };
  }
  settle(result: NarrativeCommandResponse<R>): boolean {
    if (this.current.phase !== "APPLYING" && this.current.phase !== "RECOVERING") return false;
    const { draftId, command } = this.current;
    const commandId = result.kind === "CONFIRMED" ? result.receipt.commandId : result.commandId;
    if (commandId !== command.commandId) return false;
    if (result.kind === "REJECTED") {
      if (this.current.phase !== "APPLYING") return false;
      this.current = { phase: "IDLE" }; return true;
    }
    if (result.kind === "CONFIRMED" && (!this.policy.validateReceipt(result.receipt)
      || (this.current.phase === "RECOVERING" ? result.receipt.status !== "CONFIRMED" : result.receipt.status === "CONFIRMED"))) return false;
    this.current = result.kind === "CONFIRMED"
      ? { phase: "RELOAD_REQUIRED", draftId, command, receipt: structuredClone(result.receipt) }
      : { phase: "UNCONFIRMED", draftId, command };
    return true;
  }
  /** The controller must first reload the current authorized document, never an old receipt snapshot. */
  acknowledgeReload(draftId: string): boolean {
    if (this.current.phase !== "RELOAD_REQUIRED" || !z.string().uuid().safeParse(draftId).success
      || this.current.draftId !== draftId) return false;
    this.current = { phase: "IDLE" }; return true;
  }
}
