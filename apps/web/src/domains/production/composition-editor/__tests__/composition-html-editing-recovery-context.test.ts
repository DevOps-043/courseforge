import test from "node:test";
import assert from "node:assert/strict";
import { resolveHtmlEditingRecoveryContext } from "../composition-html-editing-recovery-context.client";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };

test("recovery context is draft/owner scoped without requiring any selected clip or flag", () => {
  const context = resolveHtmlEditingRecoveryContext(scope);
  assert.deepEqual(context?.scope, scope); assert.equal(context?.key, `${uuid}:${uuid}:${uuid}`);
});

test("every actor/organization/draft change produces a different recovery remount key", () => {
  const keys = new Set([resolveHtmlEditingRecoveryContext(scope)?.key]);
  for (const field of ["actorId", "organizationId", "draftId"] as const) {
    const context = resolveHtmlEditingRecoveryContext({ ...scope, [field]: other });
    assert.ok(context); assert.equal(keys.has(context.key), false); keys.add(context.key);
  }
  assert.equal(keys.size, 4);
});

test("missing, malformed or substituted current owner context never falls back to a previous draft", () => {
  for (const input of [null, undefined, {}, { ...scope, actorId: null }, { ...scope, organizationId: null },
    { ...scope, draftId: "../foreign" }, { ...scope, actorId: "invalid" }, { ...scope, organizationId: "invalid" },
    { ...scope, draftId: uuid, clipId: "extra authority" }]) assert.equal(resolveHtmlEditingRecoveryContext(input), null);
});

test("ordinary rerenders with identical owner/draft preserve recovery request identity", () => {
  const first = resolveHtmlEditingRecoveryContext(scope), second = resolveHtmlEditingRecoveryContext({ ...scope });
  assert.ok(first); assert.ok(second); assert.equal(first.key, second.key); assert.deepEqual(first.scope, second.scope);
});
