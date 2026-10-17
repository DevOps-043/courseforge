import test from "node:test";
import assert from "node:assert/strict";
import { sendHtmlEditingInitialization } from "../composition-html-editing-initialization-http.client";
import { beginHtmlEditingInitializationJournal, readHtmlEditingInitializationJournal,
  acknowledgeHtmlEditingInitializationJournal, closeVerifiedHtmlEditingInitializationJournal } from "../composition-html-editing-initialization-journal.client";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
const body = { templateId: "lesson-slide", templateVersion: 1, expectedDocumentHash: "a".repeat(64) };
const ack = { status: "CONFIRMED" as const, created: true, version: 1 as const, sha256: "b".repeat(64), compositionDocumentHash: body.expectedDocumentHash };
const envelope = (data: unknown = ack) => ({ success: true, requestId: uuid, correlationId: uuid, data });
function journal() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const input = { scope, operationId: uuid, clipId: "slide-1", createdAt: 1, request: body };
  return { values, storage, input };
}

test("initialization sends one typed relative POST and validates created/existing ACK", async () => {
  for (const created of [true, false]) {
    let calls = 0;
    const result = await sendHtmlEditingInitialization({ scope, clipId: "slide-1", body, fetcher: async (url, options) => {
      calls++; assert.equal(url, `/api/production/hyperframes/drafts/${uuid}/html-editing/slide-1/initialize`);
      assert.equal(options?.method, "POST"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.cache, "no-store");
      assert.equal(options?.redirect, "error"); assert.deepEqual(JSON.parse(String(options?.body)), body);
      return Response.json(envelope({ ...ack, created }), { status: created ? 201 : 200 });
    } });
    assert.equal(result.created, created); assert.equal(calls, 1);
  }
});

test("invalid owner/body, injected authority, malformed clip and pre-abort never initialize", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json(envelope()); };
  for (const input of [
    { scope: { ...scope, actorId: "invalid" }, clipId: "slide-1", body },
    { scope, clipId: "../foreign", body },
    { scope, clipId: "slide-1", body: { ...body, actorId: other } },
    { scope, clipId: "slide-1", body: { ...body, expectedDocumentHash: "invalid" } },
    { scope, clipId: "slide-1", body, signal: controller.signal },
  ]) await assert.rejects(sendHtmlEditingInitialization({ ...input, fetcher }), /INVALID_REQUEST/);
  assert.equal(calls, 0);
});

test("invalid hash/correlation/version/status ACK remains unknown without retry", async () => {
  const replies = [
    Response.json(envelope({ ...ack, compositionDocumentHash: "c".repeat(64) }), { status: 201 }),
    Response.json({ ...envelope(), correlationId: other }, { status: 201 }),
    Response.json(envelope({ ...ack, version: 2 }), { status: 201 }),
    Response.json(envelope(), { status: 200 }),
    Response.json(envelope({ ...ack, privateDetails: "not allowed" }), { status: 201 }),
    new Response(null, { status: 403 }),
  ];
  for (const reply of replies) {
    let calls = 0;
    await assert.rejects(sendHtmlEditingInitialization({ scope, clipId: "slide-1", body, fetcher: async () => { calls++; return reply; } }), /OUTCOME_UNKNOWN/);
    assert.equal(calls, 1);
  }
});

test("oversized/non-JSON/lost initialization response never falls back or retries", async () => {
  for (const failure of ["oversized", "html", "lost"] as const) {
    let calls = 0;
    await assert.rejects(sendHtmlEditingInitialization({ scope, clipId: "slide-1", body, fetcher: async () => {
      calls++; if (failure === "lost") throw new Error("provider private details");
      return new Response(failure === "oversized" ? " ".repeat(4097) : "<html>login</html>",
        { status: 201, headers: { "content-type": failure === "oversized" ? "application/json" : "text/html" } });
    } }), /OUTCOME_UNKNOWN/);
    assert.equal(calls, 1);
  }
});

test("initialization intent survives reload, separates owner keys and cannot close unknown outcome", () => {
  const f = journal(); assert.equal(beginHtmlEditingInitializationJournal(f.storage, f.input), true);
  const state = readHtmlEditingInitializationJournal(f.storage, scope); assert.equal(state.status, "PENDING");
  assert.equal(beginHtmlEditingInitializationJournal(f.storage, { ...f.input, operationId: other }), false);
  if (state.status === "PENDING") assert.equal(closeVerifiedHtmlEditingInitializationJournal(f.storage, scope, state.entry), false);
  assert.equal(readHtmlEditingInitializationJournal(f.storage, { ...scope, actorId: other }).status, "EMPTY");
  assert.equal(readHtmlEditingInitializationJournal(f.storage, { ...scope, organizationId: other }).status, "EMPTY");
  assert.equal(readHtmlEditingInitializationJournal(f.storage, { ...scope, draftId: other }).status, "EMPTY");
  assert.equal(f.values.size, 1);
});

test("direct initialization ACK must match hash and exact intent; persistence alone does not close", () => {
  const f = journal(); assert.equal(beginHtmlEditingInitializationJournal(f.storage, f.input), true);
  const state = readHtmlEditingInitializationJournal(f.storage, scope); assert.equal(state.status, "PENDING"); if (state.status !== "PENDING") return;
  assert.equal(acknowledgeHtmlEditingInitializationJournal(f.storage, scope, state.entry, { ...ack, compositionDocumentHash: "c".repeat(64) }), false);
  assert.equal(acknowledgeHtmlEditingInitializationJournal(f.storage, scope, { ...state.entry, operationId: other }, ack), false);
  assert.equal(acknowledgeHtmlEditingInitializationJournal(f.storage, scope, state.entry, ack), true);
  assert.equal(closeVerifiedHtmlEditingInitializationJournal(f.storage, scope, state.entry), false);
  const confirmed = readHtmlEditingInitializationJournal(f.storage, scope); assert.equal(confirmed.status, "PENDING"); if (confirmed.status !== "PENDING") return;
  assert.equal(acknowledgeHtmlEditingInitializationJournal(f.storage, scope, confirmed.entry, { ...ack, sha256: "d".repeat(64) }), false);
  assert.equal(closeVerifiedHtmlEditingInitializationJournal(f.storage, scope, confirmed.entry), true);
  assert.equal(readHtmlEditingInitializationJournal(f.storage, scope).status, "EMPTY");
});

test("corrupt/foreign/oversized initialization journal remains unavailable and cannot be overwritten", () => {
  for (const failure of ["corrupt", "foreign", "oversized"] as const) {
    const f = journal(); assert.equal(beginHtmlEditingInitializationJournal(f.storage, f.input), true);
    const key = [...f.values.keys()][0]!;
    f.values.set(key, failure === "corrupt" ? "{broken" : failure === "oversized" ? " ".repeat(4097)
      : JSON.stringify({ ...f.input, schemaVersion: 1, scope: { ...scope, actorId: other } }));
    const raw = f.values.get(key);
    assert.equal(readHtmlEditingInitializationJournal(f.storage, scope).status, "UNAVAILABLE");
    assert.equal(beginHtmlEditingInitializationJournal(f.storage, f.input), false); assert.equal(f.values.get(key), raw);
  }
});

test("missing/quota-failing storage or forged preconfirmed intent cannot claim durable tracking", () => {
  const f = journal(); assert.equal(beginHtmlEditingInitializationJournal(null, f.input), false);
  const broken = { ...f.storage, setItem: () => { throw new Error("quota"); } };
  assert.equal(beginHtmlEditingInitializationJournal(broken, f.input), false);
  assert.equal(beginHtmlEditingInitializationJournal(f.storage, { ...f.input, acknowledgment: ack } as typeof f.input), false);
  assert.equal(f.values.size, 0);
});
