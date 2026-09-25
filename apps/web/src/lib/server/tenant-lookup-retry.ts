export interface TenantLookupResult<T> {
  data: T;
  error: unknown;
}

interface TenantLookupRetryOptions {
  attemptTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_RETRY_DELAYS_MS = [0, 150, 500] as const;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 3_000;

async function runLookupAttempt<T>(
  lookup: (signal: AbortSignal) => Promise<TenantLookupResult<T>>,
  timeoutMs: number,
): Promise<TenantLookupResult<T>> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error("Tenant lookup timed out");
      error.name = "TimeoutError";
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });

  try {
    // Abort cancels the database request; the deadline also bounds a client
    // that fails to settle its promise after cancellation.
    return await Promise.race([lookup(controller.signal), deadline]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function serializeLookupError(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const values = ["message", "details", "hint", "code", "cause"]
      .filter((key) => key in error)
      .map((key) => String((error as Record<string, unknown>)[key]));

    if (values.length > 0) return values.join(" ").toLowerCase();
  }

  return String(error).toLowerCase();
}

export function isTransientTenantLookupError(error: unknown) {
  const serialized = serializeLookupError(error);
  return /fetch failed|network|econnreset|econnrefused|enotfound|etimedout|socket|terminated|timeout|timed out|bad gateway|service unavailable|gateway timeout|\b50[234]\b/.test(
    serialized,
  );
}

export async function runTenantLookupWithRetry<T>(
  lookup: (signal: AbortSignal) => Promise<TenantLookupResult<T>>,
  options: TenantLookupRetryOptions = {},
): Promise<TenantLookupResult<T>> {
  const retryDelaysMs = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs <= 0 || retryDelaysMs.length === 0) {
    throw new Error("Tenant lookup requires a positive timeout and at least one attempt.");
  }
  const sleep =
    options.sleep ||
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  let lastResult: TenantLookupResult<T> | null = null;

  for (const [attempt, delayMs] of retryDelaysMs.entries()) {
    if (attempt > 0 && delayMs > 0) await sleep(delayMs);

    try {
      const result = await runLookupAttempt(lookup, attemptTimeoutMs);
      lastResult = result;
      if (!result.error || !isTransientTenantLookupError(result.error)) {
        return result;
      }
    } catch (error) {
      lastResult = { data: null as T, error };
      if (!isTransientTenantLookupError(error)) return lastResult;
    }
  }

  return lastResult as TenantLookupResult<T>;
}
