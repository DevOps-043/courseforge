import test from "node:test";
import assert from "node:assert/strict";
import { beginHtmlEditingJournal, readHtmlEditingJournal, acknowledgeHtmlEditingJournal, closeRebasedHtmlEditingJournal } from "../composition-html-editing-journal.client";

const actorId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const scope = { actorId, organizationId: actorId, draftId: actorId };
const expected = { version: 1, sha256: "a".repeat(64) };
const next = { version: 2, sha256: "b".repeat(64) };
const input = { scope, operationId, clipId: "slide-1", createdAt: 1, expected, expectedCompositionDocumentHash: "c".repeat(64) };
const ack = { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED", changed: true, previous: expected, next };
function memory() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

test("journal persists before dispatch and blocks duplicate or other-clip writes after reload", () => {
  const storage = memory();
  assert.equal(beginHtmlEditingJournal(storage, input), true);
  assert.equal(readHtmlEditingJournal(storage, scope).status, "PENDING");
  assert.equal(beginHtmlEditingJournal(storage, input), false);
  assert.equal(beginHtmlEditingJournal(storage, { ...input, clipId: "slide-2" }), false);
  const serialized = [...storage.entries.values()][0];
  assert.equal(serialized.includes("overrides"), false);
});

test("unknown writes cannot be closed by a matching read; exact POST ACK and rebase are required", () => {
  const storage = memory(); beginHtmlEditingJournal(storage, input);
  assert.equal(acknowledgeHtmlEditingJournal(storage, scope, operationId, undefined), false);
  assert.equal(closeRebasedHtmlEditingJournal(storage, scope, operationId, next), false);
  assert.equal(acknowledgeHtmlEditingJournal(storage, scope, actorId, ack), false);
  assert.equal(acknowledgeHtmlEditingJournal(storage, scope, operationId, { ...ack, previous: next }), false);
  assert.equal(acknowledgeHtmlEditingJournal(storage, scope, operationId, ack), true);
  assert.equal(closeRebasedHtmlEditingJournal(storage, scope, operationId, expected), false);
  assert.equal(closeRebasedHtmlEditingJournal(storage, scope, operationId, next), true);
  assert.equal(readHtmlEditingJournal(storage, scope).status, "EMPTY");
});

test("corrupt, oversized and foreign stored tracking is preserved and fails closed", () => {
  for (const encoded of ["broken", "x".repeat(4097), JSON.stringify({ ...input, schemaVersion: 1, scope: { ...scope, actorId: operationId } })]) {
    const storage = memory(); beginHtmlEditingJournal(storage, input);
    const key = [...storage.entries.keys()][0]; storage.setItem(key, encoded);
    assert.equal(readHtmlEditingJournal(storage, scope).status, "UNAVAILABLE");
    assert.equal(beginHtmlEditingJournal(storage, input), false);
    assert.equal(storage.getItem(key), encoded);
  }
});

test("unavailable or unverified persistence prevents admission and owner slots remain isolated", () => {
  assert.equal(beginHtmlEditingJournal(memory(), { ...input, acknowledgment: ack } as typeof input), false);
  assert.equal(beginHtmlEditingJournal(null, input), false);
  assert.equal(beginHtmlEditingJournal({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, input), false);
  const storage = memory(); beginHtmlEditingJournal(storage, input);
  assert.equal(readHtmlEditingJournal(storage, { ...scope, actorId: operationId }).status, "EMPTY");
  assert.equal(closeRebasedHtmlEditingJournal(storage, { ...scope, actorId: operationId }, operationId, next), false);
});
