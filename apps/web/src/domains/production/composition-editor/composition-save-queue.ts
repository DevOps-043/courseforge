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
  private running = false;

  constructor(
    private readonly execute: (command: TCommand) => Promise<boolean>,
    private readonly onStateChange?: (snapshot: CompositionSaveQueueSnapshot) => void,
    private readonly onOverflow?: () => void,
  ) {}

  enqueue(command: TCommand) {
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
      status: this.running ? "RUNNING" : "IDLE",
    };
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
    }
  }

  private emitState() {
    this.onStateChange?.(this.snapshot());
  }
}
