/** Authorization failures need configuration changes, not hours of retries. */
export function isPermanentProviderFailure(status: number): boolean {
  return [400, 401, 403, 404, 422].includes(status);
}

export function importRetryDelaySeconds(failureCount: number): number {
  return Math.min(30 * 2 ** Math.min(Math.max(0, failureCount), 5), 900);
}
