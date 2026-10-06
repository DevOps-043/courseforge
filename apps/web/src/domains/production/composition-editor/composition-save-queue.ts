import { COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG } from "./composition-preview-sync.config";

export interface CompositionSaveQueueSnapshot {
  pendingCount: number;
  status: "IDLE" | "RUNNING";
}

type QueueEntry<TCommand> = {
  command: TCommand;
  resolve: (saved: boolean) => void;
};

/** Serializes saves and fails closed: one failed command cancels the queued tail. */
export class CompositionSaveQueue<TCommand> {
  private readonly entries: Array<QueueEntry<TCommand>> = [];
  private readonly idleWaiters: Array<() => void> = [];
  private running = false;
  private externallyReserved = false;

  constructor(
    private readonly execute: (command: TCommand) => Promise<boolean>,
    private readonly onStateChange?: (snapshot: CompositionSaveQueueSnapshot) => void,
    private readonly onOverflow?: () => void,
  ) {}

  enqueue(command: TCommand) {
    if (this.externallyReserved) return Promise.resolve(false);
    if (this.entries.length >= COMPOSITION_PREVIEW_SAVE_QUEUE_CONFIG.maxPendingCommands) {
      this.onOverflow?.();
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      this.entries.push({ command, resolve });
      this.emitState();
      void this.drain();
    });
  }

  snapshot(): CompositionSaveQueueSnapshot {
    return {
      pendingCount: this.entries.length,
      status: this.running || this.externallyReserved ? "RUNNING" : "IDLE",
    };
  }

  /** Resolves after the active save and every queued command have settled. */
  whenIdle(): Promise<void> {
    if (!this.running && !this.externallyReserved && this.entries.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /** Immediate reservation, never a queued wait against a stale document base.
   * External workflow must also fence mutations which bypass this save queue. */
  async runExclusiveWhenIdle<TResult>(task: () => Promise<TResult>): Promise<TResult> {
    if (this.running || this.externallyReserved || this.entries.length > 0) throw new Error("COMPOSITION_SAVE_QUEUE_BUSY");
    this.externallyReserved = true;
    try {
      this.emitState();
      return await task();
    } finally {
      this.externallyReserved = false;
      try { this.emitState(); } finally { this.resolveIdleWaiters(); }
    }
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    this.emitState();
    try {
      while (this.entries.length > 0) {
        const entry = this.entries.shift()!;
        let saved = false;
        try {
          saved = await this.execute(entry.command);
        } catch {
          saved = false;
        }
        entry.resolve(saved);
        if (!saved) {
          this.entries.splice(0).forEach((pending) => pending.resolve(false));
          break;
        }
        this.emitState();
      }
    } finally {
      this.running = false;
      this.emitState();
      this.resolveIdleWaiters();
    }
  }

  private emitState() {
    this.onStateChange?.(this.snapshot());
  }

  private resolveIdleWaiters() {
    if (this.running || this.externallyReserved || this.entries.length > 0) return;
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
}
