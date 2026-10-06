export const CONFORMANCE_JOB_LEASE_POLICY = Object.freeze({heartbeatMs: 60_000,
  maximumHeartbeatMs: 60_000, renewalTimeoutMs: 15_000, maximumRenewalTimeoutMs: 30_000, minimumTimerMs: 10});

export function validateConformanceJobLeaseTimers(heartbeatMs: number, renewalTimeoutMs: number) {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < CONFORMANCE_JOB_LEASE_POLICY.minimumTimerMs
    || heartbeatMs > CONFORMANCE_JOB_LEASE_POLICY.maximumHeartbeatMs
    || !Number.isSafeInteger(renewalTimeoutMs) || renewalTimeoutMs < CONFORMANCE_JOB_LEASE_POLICY.minimumTimerMs
    || renewalTimeoutMs > CONFORMANCE_JOB_LEASE_POLICY.maximumRenewalTimeoutMs)
    throw new Error("CONFORMANCE_JOB_HEARTBEAT_INVALID");
}

/** Cooperative stage boundary only; it does not claim to kill non-cooperative descendants. */
export function assertConformanceJobActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED");
}

/** One renewal in flight. Ambiguous/late acknowledgments never restore lost ownership. */
export function createConformanceJobLease(input: {renew: (signal: AbortSignal) => Promise<boolean>;
  signal?: AbortSignal; heartbeatMs?: number; renewalTimeoutMs?: number}) {
  const heartbeatMs = input.heartbeatMs ?? CONFORMANCE_JOB_LEASE_POLICY.heartbeatMs;
  const renewalTimeoutMs = input.renewalTimeoutMs ?? CONFORMANCE_JOB_LEASE_POLICY.renewalTimeoutMs;
  validateConformanceJobLeaseTimers(heartbeatMs, renewalTimeoutMs);
  if (typeof input.renew !== "function") throw new Error("CONFORMANCE_JOB_HEARTBEAT_INVALID");
  const execution = new AbortController();
  let lost = false, closed = false, pending: Promise<void> | undefined;
  const stopExecution = () => execution.abort(new Error("CONFORMANCE_JOB_EXECUTION_CANCELLED"));
  const lose = () => {lost = true; stopExecution();};
  if (input.signal?.aborted) stopExecution();
  else input.signal?.addEventListener("abort", stopExecution, {once: true});
  const renew = async () => {
    const renewal = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const acknowledged = await Promise.race([
        Promise.resolve().then(() => input.renew(renewal.signal)),
        new Promise<false>(resolve => {timeout = setTimeout(() => {
          renewal.abort(new Error("CONFORMANCE_JOB_RENEWAL_TIMEOUT")); resolve(false);
        }, renewalTimeoutMs);}),
      ]);
      if (acknowledged !== true) lose();
    } catch {lose();} finally {clearTimeout(timeout);}
  };
  const timer = setInterval(() => {
    if (closed || lost || pending) return;
    pending = renew().finally(() => {pending = undefined;});
  }, heartbeatMs);
  return {
    signal: execution.signal,
    get lost() {return lost;},
    async close() {
      closed = true; clearInterval(timer);
      // The timeout bounds drain even if an adapter ignores its AbortSignal.
      try {await pending;} finally {input.signal?.removeEventListener("abort", stopExecution);}
    },
  };
}
