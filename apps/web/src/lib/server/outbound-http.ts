export const DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS = 60_000;
export const DEFAULT_OUTBOUND_TOTAL_TIMEOUT_MS = 30_000;

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class OutboundResponseTooLargeError extends Error {
  readonly code = "OUTBOUND_RESPONSE_TOO_LARGE";

  constructor(readonly maximumBytes: number) {
    super(`La respuesta saliente excede el limite de ${maximumBytes} bytes.`);
    this.name = "OutboundResponseTooLargeError";
  }
}

export class OutboundCircuitOpenError extends Error {
  readonly code = "OUTBOUND_CIRCUIT_OPEN";

  constructor(readonly retryAfterSeconds: number) {
    super("El proveedor externo esta temporalmente bloqueado por fallos consecutivos.");
    this.name = "OutboundCircuitOpenError";
  }
}

export class OutboundCircuitBreaker {
  private consecutiveFailures = 0;
  private openedAtMilliseconds: number | null = null;
  private recoveryProbeInFlight = false;

  constructor(
    private readonly failureThreshold = 5,
    private readonly recoveryTimeoutMilliseconds = 30_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(failureThreshold) || failureThreshold <= 0) {
      throw new Error("El umbral del circuit breaker debe ser un entero positivo.");
    }
    if (!Number.isFinite(recoveryTimeoutMilliseconds) || recoveryTimeoutMilliseconds <= 0) {
      throw new Error("El tiempo de recuperacion del circuit breaker debe ser positivo.");
    }
  }

  snapshot() {
    const now = this.now();
    const isCoolingDown = this.openedAtMilliseconds !== null
      && now - this.openedAtMilliseconds < this.recoveryTimeoutMilliseconds;
    return {
      consecutiveFailures: this.consecutiveFailures,
      recoveryProbeInFlight: this.recoveryProbeInFlight,
      state: isCoolingDown
        ? "open" as const
        : this.openedAtMilliseconds !== null
          ? "half_open" as const
          : "closed" as const,
    };
  }

  async execute(operation: () => Promise<Response>) {
    const isRecoveryProbe = this.acquire();
    try {
      const response = await operation();
      if (RETRYABLE_STATUS_CODES.has(response.status)) {
        this.recordFailure();
      } else {
        this.reset();
      }
      return response;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      if (isRecoveryProbe) this.recoveryProbeInFlight = false;
    }
  }

  private acquire() {
    if (this.openedAtMilliseconds === null) return false;
    const elapsed = this.now() - this.openedAtMilliseconds;
    if (elapsed < this.recoveryTimeoutMilliseconds) {
      throw new OutboundCircuitOpenError(
        Math.max(1, Math.ceil((this.recoveryTimeoutMilliseconds - elapsed) / 1_000)),
      );
    }
    if (this.recoveryProbeInFlight) {
      throw new OutboundCircuitOpenError(1);
    }
    this.recoveryProbeInFlight = true;
    return true;
  }

  private recordFailure() {
    this.consecutiveFailures += 1;
    if (
      this.openedAtMilliseconds !== null
      || this.consecutiveFailures >= this.failureThreshold
    ) {
      this.openedAtMilliseconds = this.now();
    }
  }

  private reset() {
    this.consecutiveFailures = 0;
    this.openedAtMilliseconds = null;
  }
}

export interface IdempotentRetryOptions {
  attempts?: number;
  baseDelayMilliseconds?: number;
  circuitBreaker?: OutboundCircuitBreaker;
  maxDelayMilliseconds?: number;
  perAttemptTimeoutMilliseconds?: number;
  totalTimeoutMilliseconds?: number;
}

export function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMilliseconds = DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS,
) {
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new Error("El timeout de la solicitud saliente debe ser un numero positivo.");
  }

  const deadlineSignal = AbortSignal.timeout(timeoutMilliseconds);
  const signal = init.signal
    ? AbortSignal.any([init.signal, deadlineSignal])
    : deadlineSignal;

  return fetch(input, {
    ...init,
    signal,
  });
}

export async function readResponseArrayBufferWithLimit(
  response: Response,
  maximumBytes: number,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("El limite de respuesta debe ser un entero positivo.");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new OutboundResponseTooLargeError(maximumBytes);
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  let totalBytes = 0;
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new OutboundResponseTooLargeError(maximumBytes);
      }
      chunks.push(value);
    }
    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  } finally {
    reader.releaseLock();
  }
}

export async function readResponseTextWithLimit(
  response: Response,
  maximumBytes: number,
) {
  const buffer = await readResponseArrayBufferWithLimit(response, maximumBytes);
  return new TextDecoder().decode(buffer);
}

export async function readJsonResponseWithLimit<T = unknown>(
  response: Response,
  maximumBytes: number,
): Promise<T> {
  const text = await readResponseTextWithLimit(response, maximumBytes);
  return JSON.parse(text) as T;
}

function parseRetryAfterMilliseconds(value: string | null, nowMs: number) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : null;
}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchIdempotentWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: IdempotentRetryOptions = {},
) {
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("Los reintentos salientes solo admiten operaciones GET o HEAD.");
  }

  const attempts = options.attempts ?? 3;
  const baseDelayMilliseconds = options.baseDelayMilliseconds ?? 250;
  const maxDelayMilliseconds = options.maxDelayMilliseconds ?? 2_000;
  const perAttemptTimeoutMilliseconds = options.perAttemptTimeoutMilliseconds
    ?? DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS;
  const totalTimeoutMilliseconds = options.totalTimeoutMilliseconds
    ?? DEFAULT_OUTBOUND_TOTAL_TIMEOUT_MS;
  for (const [name, value] of Object.entries({
    attempts,
    baseDelayMilliseconds,
    maxDelayMilliseconds,
    perAttemptTimeoutMilliseconds,
    totalTimeoutMilliseconds,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`La opción de reintento ${name} debe ser positiva.`);
    }
  }
  if (!Number.isInteger(attempts)) {
    throw new Error("La cantidad de intentos debe ser un entero positivo.");
  }

  const executeRequest = async () => {
    const totalDeadlineSignal = AbortSignal.timeout(totalTimeoutMilliseconds);
    const operationSignal = init.signal
      ? AbortSignal.any([init.signal, totalDeadlineSignal])
      : totalDeadlineSignal;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchWithDeadline(
          input,
          { ...init, method, signal: operationSignal },
          perAttemptTimeoutMilliseconds,
        );
        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === attempts) {
          return response;
        }

        const retryAfter = parseRetryAfterMilliseconds(
          response.headers.get("retry-after"),
          Date.now(),
        );
        if (retryAfter !== null && retryAfter > maxDelayMilliseconds) {
          return response;
        }
        const exponentialDelay = baseDelayMilliseconds * (2 ** (attempt - 1));
        const jitteredDelay = exponentialDelay * (0.5 + (Math.random() * 0.5));
        const delay = retryAfter ?? Math.min(jitteredDelay, maxDelayMilliseconds);
        await response.body?.cancel().catch(() => undefined);
        await waitForRetry(delay, operationSignal);
      } catch (error) {
        if (operationSignal.aborted || attempt === attempts) throw error;
        const exponentialDelay = baseDelayMilliseconds * (2 ** (attempt - 1));
        const delay = Math.min(
          exponentialDelay * (0.5 + (Math.random() * 0.5)),
          maxDelayMilliseconds,
        );
        await waitForRetry(delay, operationSignal);
      }
    }

    throw new Error("La solicitud idempotente agotó sus intentos.");
  };

  return options.circuitBreaker
    ? options.circuitBreaker.execute(executeRequest)
    : executeRequest();
}
