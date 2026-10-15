import type {CompositionQaCdpClient} from "./composition-qa-browser";

export type ProducerCdpChannel = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(method: string, handler: (params: Record<string, unknown>) => void): unknown;
  off(method: string, handler: (params: Record<string, unknown>) => void): unknown;
};
export const BORROWED_PRODUCER_CDP_POLICY = {id: "BORROWED_ORIGINAL_PRODUCER_CDP_V1", maximumSubscriptions: 32} as const;

/** The SDK retains ownership. close removes this adapter's listeners, never detaches CDP.
 * Abort does not prove an in-flight command stopped; the owned process fence remains mandatory. */
export function borrowProducerCdpChannel(channel: ProducerCdpChannel, signal: AbortSignal): CompositionQaCdpClient {
  if (!(signal instanceof AbortSignal) || !channel || ![channel.send, channel.on, channel.off].every(value => typeof value === "function"))
    throw new Error("CONTROLLED_RENDER_BORROWED_CDP_INPUT_INVALID");
  signal.throwIfAborted();
  const subscriptions = new Set<{method: string; handler: (params: Record<string, unknown>) => void}>();
  let closed = false, failure: Error | undefined;
  const assertActive = () => {
    if (failure) throw failure;
    signal.throwIfAborted();
    if (closed) throw new Error("CONTROLLED_RENDER_BORROWED_CDP_CLOSED");
  };
  const remove = (subscription: {method: string; handler: (params: Record<string, unknown>) => void}) => {
    if (!subscriptions.has(subscription)) return;
    try {channel.off(subscription.method, subscription.handler); subscriptions.delete(subscription);}
    catch {failure ??= new Error("CONTROLLED_RENDER_BORROWED_CDP_CLEANUP_FAILED"); throw failure;}
  };
  const close = () => {
    closed = true;
    signal.removeEventListener("abort", onAbort);
    for (const subscription of [...subscriptions]) {try {remove(subscription);} catch {/* Finish all listener removals, then report failure. */}}
    if (failure) throw failure;
  };
  const onAbort = () => {try {close();} catch {/* Latched error is reported by the next owned close/send. */}};
  signal.addEventListener("abort", onAbort, {once: true});
  return {close, onEvent(method, callback) {
    assertActive();
    if (subscriptions.size >= BORROWED_PRODUCER_CDP_POLICY.maximumSubscriptions)
      throw new Error("CONTROLLED_RENDER_BORROWED_CDP_SUBSCRIPTION_LIMIT");
    const subscription = {method, handler: (params: Record<string, unknown>) => {
      if (closed || signal.aborted || failure) return;
      try {callback(params);} catch {failure ??= new Error("CONTROLLED_RENDER_BORROWED_CDP_EVENT_FAILED");}
    }};
    // Record first so a channel that attaches then throws can still be cleaned up.
    subscriptions.add(subscription);
    try {channel.on(method, subscription.handler);}
    catch {try {remove(subscription);} catch {/* Keep cleanup failure latched. */}
      failure ??= new Error("CONTROLLED_RENDER_BORROWED_CDP_SUBSCRIBE_FAILED"); throw failure;}
    return () => remove(subscription);
  }, async send(method, params) {
    const releasing = method === "Runtime.releaseObject";
    if (!releasing) assertActive();
    try {
      const result = await channel.send(method, params);
      if (!releasing) assertActive();
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
      return result as Record<string, unknown>;
    } catch {
      if (failure) throw failure;
      if (signal.aborted) signal.throwIfAborted();
      failure = new Error("CONTROLLED_RENDER_BORROWED_CDP_COMMAND_FAILED");
      throw failure;
    }
  }};
}
