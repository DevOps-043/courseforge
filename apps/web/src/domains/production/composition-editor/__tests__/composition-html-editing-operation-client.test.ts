import test from "node:test";
import assert from "node:assert/strict";
import { computeHtmlEditingOperationRequestSha256InBrowser, sendHtmlEditingOperation, consultHtmlEditingOperation } from "../composition-html-editing-operation-http.client";
import { computeHtmlEditingOperationRequestSha256 } from "../composition-html-editing-operation-digest.server";
import { beginHtmlEditingJournal, readHtmlEditingJournal, recordHtmlEditingJournalReceipt, acknowledgeHtmlEditingJournal } from "../composition-html-editing-journal.client";
import { dispatchTrackedHtmlEditingMutation } from "../composition-html-editing-dispatch.client";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
  const body = { action: "COMMAND" as const, expected: { version: 1, sha256: "a".repeat(64) }, expectedCompositionDocumentHash: "c".repeat(64),
    overrides: [{ operation: "SET_TEXT" as const, elementId: "title", value: "Changed" }] };
  const requestSha256 = computeHtmlEditingOperationRequestSha256(body), locator = { scope, clipId: "slide-1", operationId: other, requestSha256 };
  const receipt = { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const, owner: scope, operationId: other,
    requestSha256, clipId: "slide-1", acknowledgment: { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED" as const, changed: true,
      previous: body.expected, next: { version: 2, sha256: "b".repeat(64) } } };
  const response = (data: unknown = { status: "RECORDED", receipt }) => Response.json({ success: true, requestId: uuid, correlationId: uuid, data });
  const entries = new Map<string, string>(), storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const journal = { ...locator, createdAt: 1, expected: body.expected, expectedCompositionDocumentHash: body.expectedCompositionDocumentHash };
  return { locator, body, receipt, response, entries, storage, journal };
}

test("browser/server digest parity covers Unicode, canonical key order and restoration", async () => {
  const f = setup();
  for (const body of [f.body, { ...f.body, overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Español 😀" }] },
    { action: "RESTORE", expected: f.body.expected, expectedCompositionDocumentHash: f.body.expectedCompositionDocumentHash, restore: f.body.expected }]) {
    assert.equal(await computeHtmlEditingOperationRequestSha256InBrowser(body), computeHtmlEditingOperationRequestSha256(body));
  }
});

test("durable POST sends one typed body to relative endpoint without owner/digest authority fields", async () => {
  const f = setup(); let calls = 0;
  const result = await sendHtmlEditingOperation({ ...f.locator, body: f.body, fetcher: async (url, options) => {
    calls++; assert.equal(options?.method, "POST"); assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "same-origin");
    assert.ok(String(url).endsWith(`/operations/${other}`)); assert.deepEqual(JSON.parse(String(options?.body)), f.body);
    return f.response();
  } });
  assert.deepEqual(result, f.receipt); assert.equal(calls, 1);
});

test("explicit GET is metadata only and preserves NOT_FOUND as unknown", async () => {
  const f = setup(); let calls = 0;
  const result = await consultHtmlEditingOperation({ ...f.locator, fetcher: async (url, options) => {
    calls++; assert.equal(options?.method, "GET"); assert.equal(options?.body, undefined);
    assert.ok(String(url).endsWith(`?requestSha256=${f.locator.requestSha256}`)); return f.response({ status: "NOT_FOUND" });
  } });
  assert.deepEqual(result, { status: "NOT_FOUND" }); assert.equal(calls, 1);
});

test("mismatched digest, invalid owner/ID, injected authority and pre-abort perform no dispatch", async () => {
  const f = setup(); let calls = 0; const fetcher: typeof fetch = async () => { calls++; return f.response(); };
  for (const input of [{ ...f.locator, requestSha256: "f".repeat(64), body: f.body },
    { ...f.locator, operationId: "bad", body: f.body }, { ...f.locator, body: { ...f.body, actorId: uuid } }]) {
    await assert.rejects(sendHtmlEditingOperation({ ...input, fetcher }), /INVALID_REQUEST/);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sendHtmlEditingOperation({ ...f.locator, body: f.body, signal: controller.signal, fetcher })); assert.equal(calls, 0);
});

test("foreign/malformed receipts and oversized/non-JSON responses never cause retries", async () => {
  for (const patch of [{ operationId: uuid }, { requestSha256: "f".repeat(64) }, { owner: { actorId: other, organizationId: uuid, draftId: uuid } }]) {
    const f = setup(); let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return f.response({ status: "RECORDED", receipt: { ...f.receipt, ...patch } }); };
    await assert.rejects(sendHtmlEditingOperation({ ...f.locator, body: f.body, fetcher }), /OUTCOME_UNKNOWN/); assert.equal(calls, 1);
  }
  const f = setup();
  for (const response of [new Response("x".repeat(6000), { headers: { "content-type": "application/json" } }), new Response("private")]) {
    await assert.rejects(consultHtmlEditingOperation({ ...f.locator, fetcher: async () => response }), /READ_UNAVAILABLE/);
  }
});

test("journal preserves digest across reload and cannot accept plain ACK or foreign receipt", () => {
  const f = setup(); assert.equal(beginHtmlEditingJournal(f.storage, f.journal), true);
  assert.equal(acknowledgeHtmlEditingJournal(f.storage, f.locator.scope, other, f.receipt.acknowledgment), false);
  assert.equal(recordHtmlEditingJournalReceipt(f.storage, f.locator.scope, other, { ...f.receipt, requestSha256: "f".repeat(64) }), false);
  assert.equal(recordHtmlEditingJournalReceipt(f.storage, f.locator.scope, other, f.receipt), true);
  const state = readHtmlEditingJournal(f.storage, f.locator.scope); assert.equal(state.status, "PENDING");
  if (state.status === "PENDING") { assert.equal(state.entry.requestSha256, f.locator.requestSha256); assert.deepEqual(state.entry.receipt, f.receipt); }
  assert.equal([...f.entries.values()][0]!.includes("overrides"), false);
});

test("tracked durable dispatch persists digest before POST, records receipt before rebase and closes exact entry", async () => {
  const f = setup(); let calls = 0;
  const ack = await dispatchTrackedHtmlEditingMutation({ scope: f.locator.scope, clipId: f.locator.clipId, body: f.body,
    durable: true, storage: f.storage, lock: { runExclusive: async (_scope, task) => task() }, reserveNative: task => task(),
    createOperationId: () => other, isCurrentAndEditable: () => true, fetcher: async url => {
      calls++; assert.ok(String(url).includes("/operations/")); const state = readHtmlEditingJournal(f.storage, f.locator.scope);
      assert.equal(state.status, "PENDING"); if (state.status === "PENDING") assert.equal(state.entry.requestSha256, f.locator.requestSha256);
      return f.response();
    }, rebase: async () => { const state = readHtmlEditingJournal(f.storage, f.locator.scope);
      assert.equal(state.status, "PENDING"); if (state.status === "PENDING") assert.deepEqual(state.entry.receipt, f.receipt); return true; } });
  assert.deepEqual(ack, f.receipt.acknowledgment); assert.equal(calls, 1); assert.equal(readHtmlEditingJournal(f.storage, f.locator.scope).status, "EMPTY");
});

test("lost durable response keeps persisted identity without legacy fallback or receipt fabrication", async () => {
  const f = setup(); let calls = 0;
  await assert.rejects(dispatchTrackedHtmlEditingMutation({ scope: f.locator.scope, clipId: f.locator.clipId, body: f.body,
    durable: true, storage: f.storage, lock: { runExclusive: async (_scope, task) => task() }, reserveNative: task => task(),
    createOperationId: () => other, isCurrentAndEditable: () => true, fetcher: async () => { calls++; throw new Error("PRIVATE_LOST_RESPONSE"); },
    rebase: async () => { throw new Error("Must not rebase"); } }), /OUTCOME_UNKNOWN/);
  assert.equal(calls, 1); const state = readHtmlEditingJournal(f.storage, f.locator.scope); assert.equal(state.status, "PENDING");
  if (state.status === "PENDING") { assert.equal(state.entry.requestSha256, f.locator.requestSha256); assert.equal(state.entry.acknowledgment, undefined); }
});
