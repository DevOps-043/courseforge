export interface TenantLookupResult<T> {
  data: T;
  error: unknown;
}

interface TenantLookupRetryOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_RETRY_DELAYS_MS = [0, 150, 500] as const;

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
  lookup: () => Promise<TenantLookupResult<T>>,
  options: TenantLookupRetryOptions = {},
): Promise<TenantLookupResult<T>> {
  const retryDelaysMs = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ||
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  let lastResult: TenantLookupResult<T> | null = null;

  for (const [attempt, delayMs] of retryDelaysMs.entries()) {
    if (attempt > 0 && delayMs > 0) await sleep(delayMs);

    try {
      const result = await lookup();
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
