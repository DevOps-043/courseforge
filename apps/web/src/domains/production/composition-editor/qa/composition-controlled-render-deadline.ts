import {performance} from "node:perf_hooks";

export const CONTROLLED_RENDER_DEADLINE_POLICY = Object.freeze({
  id: "SHARED_MONOTONIC_RENDER_DEADLINE_V1",
  minimumMilliseconds: 1_000,
  maximumMilliseconds: 600_000,
});

/** One budget for the whole operation, not a fresh timeout for each child/stage. */
export function createControlledRenderDeadline(timeoutMs: number, externalSignal?: AbortSignal,
  clock: () => number = () => performance.now()) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < CONTROLLED_RENDER_DEADLINE_POLICY.minimumMilliseconds
    || timeoutMs > CONTROLLED_RENDER_DEADLINE_POLICY.maximumMilliseconds)
    throw new Error("CONTROLLED_RENDER_DEADLINE_INVALID");
  const startedAt = clock();
  if (!Number.isFinite(startedAt)) throw new Error("CONTROLLED_RENDER_DEADLINE_CLOCK_INVALID");
  const controller = new AbortController();
  let lastObserved = startedAt;
  let failureCode: string | undefined;
  let closed = false;
  const stop = (code: string) => {
    if (!controller.signal.aborted) {failureCode = code; controller.abort(new Error(code));}
  };
  const externalAbort = () => stop("CONTROLLED_RENDER_ABORTED");
  externalSignal?.addEventListener("abort", externalAbort, {once: true});
  if (externalSignal?.aborted) externalAbort();
  const timer = setTimeout(() => stop("CONTROLLED_RENDER_DEADLINE_EXCEEDED"), timeoutMs);
  const remainingMilliseconds = () => {
    if (closed) throw new Error("CONTROLLED_RENDER_DEADLINE_CLOSED");
    const current = clock();
    if (!Number.isFinite(current) || current < lastObserved) stop("CONTROLLED_RENDER_DEADLINE_CLOCK_INVALID");
    lastObserved = current;
    const remaining = timeoutMs - (current - startedAt);
    if (remaining <= 0) stop("CONTROLLED_RENDER_DEADLINE_EXCEEDED");
    if (controller.signal.aborted) throw new Error(failureCode);
    return Math.max(1, Math.floor(remaining));
  };
  return {signal: controller.signal, remainingMilliseconds,
    cancel() {
      if (closed) throw new Error("CONTROLLED_RENDER_DEADLINE_CLOSED");
      stop("CONTROLLED_RENDER_ABORTED");
    },
    async run<T>(operation: (signal: AbortSignal, remainingMs: number) => Promise<T>): Promise<T> {
      const remaining = remainingMilliseconds();
      let abortHandler: (() => void) | undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        abortHandler = () => reject(new Error(failureCode));
        controller.signal.addEventListener("abort", abortHandler, {once: true});
      });
      try {
        // A late result cannot escape after expiration, even if an adapter ignores its signal.
        const result = await Promise.race([operation(controller.signal, remaining), cancelled]);
        remainingMilliseconds();
        return result;
      } finally {if (abortHandler) controller.signal.removeEventListener("abort", abortHandler);}
    },
    dispose() {
      closed = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", externalAbort);
    },
  };
}
