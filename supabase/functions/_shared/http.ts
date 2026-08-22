import { requireEnv } from "./env.ts";

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export function methodNotAllowed(): Response {
  return jsonResponse({ error: "method_not_allowed" }, 405);
}

export function authorizeWorker(request: Request): Response | null {
  const actual = request.headers.get("x-courseforge-worker-key") || "";
  const expected = requireEnv("COURSEFORGE_EDGE_INVOCATION_KEY");
  if (!constantTimeEqual(actual, expected)) return jsonResponse({ error: "unauthorized" }, 401);
  return null;
}

export function logEvent(
  level: "error" | "info" | "warn",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const record = JSON.stringify({ event, level, timestamp: new Date().toISOString(), ...fields });
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.info(record);
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
