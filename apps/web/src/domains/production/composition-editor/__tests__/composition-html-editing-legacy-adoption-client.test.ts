import test from "node:test";
import assert from "node:assert/strict";
import { computeHtmlLegacyAdoptionRequestSha256 } from "../composition-html-editing-legacy-adoption-digest.server";
import { computeHtmlLegacyAdoptionRequestSha256InBrowser, sendHtmlLegacyAdoptionOperation,
  consultHtmlLegacyAdoptionOperation } from "../composition-html-editing-legacy-adoption-operation.client";
import { beginHtmlLegacyAdoptionJournal, readHtmlLegacyAdoptionJournal, recordHtmlLegacyAdoptionJournalReceipt,
  closeVerifiedHtmlLegacyAdoptionJournal } from "../composition-html-editing-legacy-adoption-journal.client";
import { htmlLegacyAdoptionReceiptSchema } from "../composition-html-editing-legacy-adoption.contract";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
const command = { actorId: uuid, organizationId: uuid, documentId: uuid, clipId: "slide_intro", operationId: other,
  request: { candidateId: other, provenanceSha256: "a".repeat(64), expectedDocumentHash: "b".repeat(64) } };
const requestSha256 = computeHtmlLegacyAdoptionRequestSha256(command);
const receipt = htmlLegacyAdoptionReceiptSchema.parse({ scope: "HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
  owner: scope, clipId: command.clipId, operationId: other, requestSha256, request: command.request,
  acknowledgment: { status: "CONFIRMED", compositionDocumentHash: "c".repeat(64), compositionDocumentVersion: 2,
    revisionVersion: 1, revisionSha256: "d".repeat(64) } });
const endpoint = `/api/production/hyperframes/drafts/${uuid}/html-editing/slide_intro/adopt/operations/${other}`;
const reply = (data: unknown = { status: "RECORDED", receipt }, status = 200) => Response.json({ success: true, requestId: uuid, correlationId: uuid, data }, { status });
function journal() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  return { values, storage, input: { command, requestSha256, createdAt: 1 } };
}

test("adoption browser/server digest share canonical preimage and bind every owner/operation field", async () => {
  assert.equal(await computeHtmlLegacyAdoptionRequestSha256InBrowser(command), requestSha256);
  assert.equal(await computeHtmlLegacyAdoptionRequestSha256InBrowser({ ...command, request: {
    expectedDocumentHash: command.request.expectedDocumentHash, provenanceSha256: command.request.provenanceSha256, candidateId: other } }), requestSha256);
  assert.notEqual(await computeHtmlLegacyAdoptionRequestSha256InBrowser({ ...command, actorId: other }), requestSha256);
});

test("client sends one relative adoption POST and recovery GET carries original intent without a body", async () => {
  let calls = 0;
  const sent = await sendHtmlLegacyAdoptionOperation({ command, requestSha256, fetcher: async (url, options) => {
    calls++; assert.equal(url, endpoint); assert.equal(options?.method, "POST"); assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store"); assert.deepEqual(JSON.parse(String(options?.body)), command.request);
    return reply();
  } }); assert.deepEqual(sent, receipt); assert.equal(calls, 1);
  for (const data of [{ status: "RECORDED", receipt }, { status: "NOT_FOUND" }]) {
    calls = 0;
    assert.deepEqual(await consultHtmlLegacyAdoptionOperation({ command, requestSha256, fetcher: async (url, options) => {
      calls++; const parsed = new URL(String(url), "https://app.example"); assert.equal(parsed.pathname, endpoint);
      assert.deepEqual(Object.fromEntries(parsed.searchParams), { ...command.request, requestSha256 });
      assert.equal(options?.method, "GET"); assert.equal(options?.body, undefined); return reply(data);
    } }), data); assert.equal(calls, 1);
  }
});

test("malformed/injected intent, wrong digest and pre-abort never dispatch adoption", async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return reply(); };
  for (const changed of [{ ...command, clipId: "../escape" }, { ...command, actorId: "bad" },
    { ...command, request: { ...command.request, sourceHtml: "SECRET" } }, { ...command, operationId: "bad" }])
    await assert.rejects(sendHtmlLegacyAdoptionOperation({ command: changed, requestSha256, fetcher }), /INVALID_REQUEST/);
  await assert.rejects(consultHtmlLegacyAdoptionOperation({ command, requestSha256: "f".repeat(64), fetcher }), /INVALID_REQUEST/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(sendHtmlLegacyAdoptionOperation({ command, requestSha256, signal: abort.signal, fetcher }), /INVALID_REQUEST/);
  assert.equal(calls, 0);
});

test("substituted receipts and ambiguous response fail without retry, fallback or private detail", async () => {
  const invalid = [{ ...receipt, owner: { ...scope, actorId: other } }, { ...receipt, clipId: "other" },
    { ...receipt, operationId: uuid }, { ...receipt, requestSha256: "e".repeat(64) },
    { ...receipt, request: { ...command.request, candidateId: uuid } }];
  for (const changed of invalid) for (const method of ["GET", "POST"]) {
    let calls = 0; const fetcher: typeof fetch = async () => { calls++; return reply({ status: "RECORDED", receipt: changed }); };
    await assert.rejects(method === "GET" ? consultHtmlLegacyAdoptionOperation({ command, requestSha256, fetcher })
      : sendHtmlLegacyAdoptionOperation({ command, requestSha256, fetcher }), method === "GET" ? /READ_UNAVAILABLE/ : /OUTCOME_UNKNOWN/);
    assert.equal(calls, 1);
  }
  for (const makeReply of [() => reply(undefined, 201), () => reply(undefined, 403), () => reply({ status: "NOT_FOUND" }),
    () => Response.json({ success: true, requestId: uuid, correlationId: other, data: { status: "RECORDED", receipt } }),
    () => new Response(" ".repeat(5121)), () => { throw new Error("PRIVATE_PROVIDER_TOKEN"); }]) {
    let calls = 0;
    await assert.rejects(sendHtmlLegacyAdoptionOperation({ command, requestSha256, fetcher: async () => { calls++; return makeReply(); } }),
      error => String(error) === "HtmlLegacyAdoptionClientError: HTML_LEGACY_ADOPTION_OUTCOME_UNKNOWN");
    assert.equal(calls, 1);
  }
});

test("journal survives reload, has distinct owner keys and never closes an uncertain operation", async () => {
  const f = journal(); assert.equal(await beginHtmlLegacyAdoptionJournal(f.storage, f.input), true);
  const pending = readHtmlLegacyAdoptionJournal(f.storage, scope); assert.equal(pending.status, "PENDING"); if (pending.status !== "PENDING") return;
  assert.equal(await beginHtmlLegacyAdoptionJournal(f.storage, f.input), false);
  assert.equal(closeVerifiedHtmlLegacyAdoptionJournal(f.storage, scope, pending.entry), false);
  for (const key of ["actorId", "organizationId", "draftId"]) assert.equal(readHtmlLegacyAdoptionJournal(f.storage, { ...scope, [key]: other }).status, "EMPTY");
  assert.equal(await recordHtmlLegacyAdoptionJournalReceipt(f.storage, scope, pending.entry, receipt), true);
  assert.equal(closeVerifiedHtmlLegacyAdoptionJournal(f.storage, scope, pending.entry), false);
  const confirmed = readHtmlLegacyAdoptionJournal(f.storage, scope); assert.equal(confirmed.status, "PENDING"); if (confirmed.status !== "PENDING") return;
  assert.equal(closeVerifiedHtmlLegacyAdoptionJournal(f.storage, scope, confirmed.entry), true);
  assert.equal(readHtmlLegacyAdoptionJournal(f.storage, scope).status, "EMPTY");
});

test("journal corruption, oversize, foreign identity and storage failure preserve rather than replace intent", async () => {
  for (const raw of ["{broken", " ".repeat(8193), JSON.stringify({ ...journal().input, schemaVersion: 1, command: { ...command, actorId: other } })]) {
    const f = journal(); assert.equal(await beginHtmlLegacyAdoptionJournal(f.storage, f.input), true);
    const key = [...f.values.keys()][0]!; f.values.set(key, raw);
    assert.equal(readHtmlLegacyAdoptionJournal(f.storage, scope).status, "UNAVAILABLE");
    assert.equal(await beginHtmlLegacyAdoptionJournal(f.storage, f.input), false); assert.equal(f.values.get(key), raw);
  }
  const f = journal(); assert.equal(await beginHtmlLegacyAdoptionJournal(null, f.input), false);
  assert.equal(await beginHtmlLegacyAdoptionJournal({ ...f.storage, setItem: () => { throw new Error(); } }, f.input), false);
  assert.equal(await beginHtmlLegacyAdoptionJournal(f.storage, { ...f.input, requestSha256: "e".repeat(64) }), false);
  assert.equal(await beginHtmlLegacyAdoptionJournal(f.storage, { ...f.input, receipt } as typeof f.input), false);
});
