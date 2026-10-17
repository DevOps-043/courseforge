import type {CompositionQaCdpClient} from "./composition-qa-browser";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

/** The capture owns this channel. Closing it interrupts commands, not the OS process tree. */
export function bindCaptureCdpCancellation(client: CompositionQaCdpClient, signal?: AbortSignal) {
  const pending = new Set<(error: Error) => void>();
  let closed = false;
  let closeFailed = false;
  const cancel = () => {
    if (closed) return;
    closed = true;
    const failure = new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED");
    for (const reject of pending) reject(failure);
    pending.clear();
    try {client.close();} catch {closeFailed = true;}
  };
  signal?.addEventListener("abort", cancel, {once: true});
  if (signal?.aborted) cancel();
  const wrapped: CompositionQaCdpClient = {
    close: () => client.close(),
    ...(client.onEvent ? {onEvent: (method: string, handler: (params: Record<string, unknown>) => void) =>
      client.onEvent!(method, params => {if (!signal?.aborted && !closed) handler(params);})} : {}),
    async send(method, params) {
      assertConformanceJobActive(signal);
      let rejectCancellation!: (error: Error) => void;
      const cancellation = new Promise<never>((_resolve, reject) => {rejectCancellation = reject;});
      pending.add(rejectCancellation);
      try {
        const result = await Promise.race([client.send(method, params), cancellation]);
        assertConformanceJobActive(signal);
        return result;
      } catch (error) {
        assertConformanceJobActive(signal);
        throw error;
      } finally {pending.delete(rejectCancellation);}
    },
  };
  return {client: wrapped, get closeFailed() {return closeFailed;},
    dispose() {signal?.removeEventListener("abort", cancel);}};
}
