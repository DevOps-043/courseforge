import assert from "node:assert/strict";
import test from "node:test";
import { resolveCorrelationId, sanitizeLogValue } from "../operational-logger";

test("operational logging preserves valid correlation IDs and replaces invalid input", () => {
  const valid = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(resolveCorrelationId(valid), valid);
  assert.match(resolveCorrelationId("attacker-controlled"), /^[0-9a-f-]{36}$/);
});

test("operational logging redacts credentials, emails and bearer tokens", () => {
  const sanitized = sanitizeLogValue({
    authorization: "Bearer abc.def.ghi",
    nested: { apiKey: "top-secret", owner: "person@example.com" },
    message: "Failed for person@example.com with Bearer token-value",
  }) as Record<string, unknown>;
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.deepEqual(sanitized.nested, { apiKey: "[REDACTED]", owner: "[REDACTED_EMAIL]" });
  assert.equal(sanitized.message, "Failed for [REDACTED_EMAIL] with Bearer [REDACTED]");
});
