export const DEFAULT_OUTBOUND_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_OUTBOUND_DOWNLOAD_TIMEOUT_MS = 60_000;

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
