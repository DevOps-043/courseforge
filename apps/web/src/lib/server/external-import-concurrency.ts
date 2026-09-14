export class ExternalImportCapacityError extends Error {
  readonly code = "EXTERNAL_IMPORT_CAPACITY";
  readonly retryAfterSeconds = 5;

  constructor(readonly reason: "queue_full" | "wait_timeout") {
    super("La capacidad temporal de importación está ocupada.");
    this.name = "ExternalImportCapacityError";
  }
}

interface QueueEntry {
  cancel: (error: unknown) => void;
  start: () => void;
}

export class BoundedConcurrencyLimiter {
  private active = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
    private readonly waitTimeoutMilliseconds: number,
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error("maxConcurrent debe ser un entero positivo.");
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new Error("maxQueued debe ser un entero no negativo.");
    }
    if (!Number.isFinite(waitTimeoutMilliseconds) || waitTimeoutMilliseconds <= 0) {
      throw new Error("waitTimeoutMilliseconds debe ser positivo.");
    }
  }

  snapshot() {
    return { active: this.active, queued: this.queue.length };
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.active >= this.maxConcurrent && this.queue.length >= this.maxQueued) {
      return Promise.reject(new ExternalImportCapacityError("queue_full"));
    }

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let queuedEntry: QueueEntry | undefined;

      const cleanupWaitingState = () => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const removeFromQueue = () => {
        if (!queuedEntry) return;
        const index = this.queue.indexOf(queuedEntry);
        if (index >= 0) this.queue.splice(index, 1);
      };
      const cancel = (error: unknown) => {
        removeFromQueue();
        cleanupWaitingState();
        reject(error);
      };
      const onAbort = () => cancel(signal?.reason);
      const start = () => {
        cleanupWaitingState();
        this.active += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.drain();
          });
      };

      if (this.active < this.maxConcurrent) {
        start();
        return;
      }

      queuedEntry = { cancel, start };
      this.queue.push(queuedEntry);
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(
        () => queuedEntry?.cancel(new ExternalImportCapacityError("wait_timeout")),
        this.waitTimeoutMilliseconds,
      );
    });
  }

  private drain() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      this.queue.shift()?.start();
    }
  }
}

export type ExternalImportProvider = "artlist" | "google_drive" | "onedrive";

const providerLimiters = new Map<ExternalImportProvider, BoundedConcurrencyLimiter>();

export function withExternalImportCapacity<T>(
  provider: ExternalImportProvider,
  task: () => Promise<T>,
  signal?: AbortSignal,
) {
  let limiter = providerLimiters.get(provider);
  if (!limiter) {
    limiter = new BoundedConcurrencyLimiter(3, 12, 10_000);
    providerLimiters.set(provider, limiter);
  }
  return limiter.run(task, signal);
}

export function isExternalImportCapacityError(
  error: unknown,
): error is ExternalImportCapacityError {
  return error instanceof ExternalImportCapacityError;
}
