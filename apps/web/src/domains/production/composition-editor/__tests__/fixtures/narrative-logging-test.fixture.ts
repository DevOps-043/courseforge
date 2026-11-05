import assert from "node:assert/strict";

export const loggingModes = ["callback", "default"] as const;
export async function withBrokenNarrativeLogger(dependencies: { logFailure?: unknown }, mode: typeof loggingModes[number],
  action: () => Promise<Response>) {
  const originalCallback = dependencies.logFailure;
  const originalConsoleError = console.error;
  let attempts = 0;
  const fail = () => { attempts++; throw new Error("CANARIO_PRIVADO_LOGGER"); };
  if (mode === "callback") dependencies.logFailure = fail;
  else { delete dependencies.logFailure; console.error = fail; }
  try {
    const response = await action();
    assert.equal(attempts, 1);
    return response;
  } finally {
    console.error = originalConsoleError;
    if (originalCallback === undefined) delete dependencies.logFailure;
    else dependencies.logFailure = originalCallback;
  }
}

export async function assertSafeNarrativeFailure(response: Response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization, Origin");
  const body = await response.json() as { requestId: string; correlationId: string; retryable: boolean;
    details: { reason: string; automaticRetryAllowed?: boolean; recoveryRequired?: boolean; requestNotApplied?: boolean; commandId?: string } };
  assert.ok(body.requestId);
  assert.equal(body.correlationId, body.requestId);
  assert.equal(body.retryable, false);
  assert.doesNotMatch(JSON.stringify(body), /CANARIO_PRIVADO|private database detail/);
  return body;
}
