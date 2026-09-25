/** Organization changes preserve the verified session's original deadline. */
export function getRemainingSessionLifetime(expiresAt: unknown, now: number): number | null {
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return null;
  }
  return expiresAt - now;
}
