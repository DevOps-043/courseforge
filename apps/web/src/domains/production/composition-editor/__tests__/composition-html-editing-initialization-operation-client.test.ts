import test from "node:test";
import assert from "node:assert/strict";
import { computeHtmlEditingInitializationRequestSha256 } from "../composition-html-editing-initialization-operation-digest.server";
import { computeHtmlEditingInitializationRequestSha256InBrowser, sendHtmlEditingInitializationOperation,
  consultHtmlEditingInitializationOperation } from "../composition-html-editing-initialization-operation.client";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
const body = { templateId: "intro", templateVersion: 1, expectedDocumentHash: "a".repeat(64) };
const locator = { scope, clipId: "slide-1", operationId: other, requestSha256: computeHtmlEditingInitializationRequestSha256(body) };
const receipt = { scope: "HTML_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: scope, clipId: locator.clipId,
  operationId: other, requestSha256: locator.requestSha256, request: body,
  acknowledgment: { status: "CONFIRMED", created: true, version: 1, sha256: "b".repeat(64), compositionDocumentHash: body.expectedDocumentHash } };
const result = { status: "RECORDED", receipt };
const reply = (data: unknown = result, status = 200) => Response.json({ success: true, requestId: uuid, correlationId: uuid, data }, { status });
const endpoint = `/api/production/hyperframes/drafts/${uuid}/html-editing/slide-1/initialize/operations/${other}`;

test("browser initial digest matches server canonical preimage independent of input property order", async () => {
  assert.equal(await computeHtmlEditingInitializationRequestSha256InBrowser(body), locator.requestSha256);
  assert.equal(await computeHtmlEditingInitializationRequestSha256InBrowser({ expectedDocumentHash: body.expectedDocumentHash,
    templateVersion: 1, templateId: "intro" }), locator.requestSha256);
});

test("durable initialization sends a single operation POST and accepts historical created receipt at 200", async () => {
  let calls = 0;
  const actual = await sendHtmlEditingInitializationOperation({ ...locator, body, fetcher: async (url, options) => {
    calls++; assert.equal(url, endpoint); assert.equal(options?.method, "POST"); assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(options?.body)), body); return reply();
  } });
  assert.deepEqual(actual, receipt); assert.equal(calls, 1);
});

test("receipt consultation is one GET; NOT_FOUND remains metadata and never initializes", async () => {
  for (const data of [result, { status: "NOT_FOUND" }]) {
    let calls = 0;
    const actual = await consultHtmlEditingInitializationOperation({ ...locator, fetcher: async (url, options) => {
      calls++; assert.equal(url, `${endpoint}?requestSha256=${locator.requestSha256}`); assert.equal(options?.method, "GET");
      assert.equal(options?.body, undefined); assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store"); return reply(data);
    } });
    assert.deepEqual(actual, data); assert.equal(calls, 1);
  }
});

test("invalid locator, mismatched digest, injected body authority and pre-abort never dispatch", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return reply(); };
  for (const invalid of [{ ...locator, scope: { ...scope, actorId: "invalid" } }, { ...locator, clipId: "../foreign" },
    { ...locator, operationId: "invalid" }, { ...locator, requestSha256: "INVALID" }]) {
    await assert.rejects(consultHtmlEditingInitializationOperation({ ...invalid, fetcher }), /INVALID_REQUEST/);
    await assert.rejects(sendHtmlEditingInitializationOperation({ ...invalid, body, fetcher }), /INVALID_REQUEST/);
  }
  await assert.rejects(sendHtmlEditingInitializationOperation({ ...locator, requestSha256: "c".repeat(64), body, fetcher }), /INVALID_REQUEST/);
  await assert.rejects(sendHtmlEditingInitializationOperation({ ...locator, body: { ...body, actorId: other }, fetcher }), /INVALID_REQUEST/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sendHtmlEditingInitializationOperation({ ...locator, body, signal: controller.signal, fetcher }), /INVALID_REQUEST/);
  await assert.rejects(consultHtmlEditingInitializationOperation({ ...locator, signal: controller.signal, fetcher }), /INVALID_REQUEST/);
  assert.equal(calls, 0);
});

test("foreign owner, clip, operation, digest and substituted request are never accepted receipts", async () => {
  const invalidReceipts = [
    ...["actorId", "organizationId", "draftId"].map(field => ({ ...receipt, owner: { ...scope, [field]: other } })),
    { ...receipt, clipId: "slide-2" }, { ...receipt, operationId: uuid }, { ...receipt, requestSha256: "c".repeat(64) },
    { ...receipt, request: { ...body, templateVersion: 2 } },
    { ...receipt, acknowledgment: { ...receipt.acknowledgment, compositionDocumentHash: "c".repeat(64) } },
  ];
  for (const invalid of invalidReceipts) for (const method of ["GET", "POST"]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return reply({ status: "RECORDED", receipt: invalid }); };
    await assert.rejects(method === "GET" ? consultHtmlEditingInitializationOperation({ ...locator, fetcher })
      : sendHtmlEditingInitializationOperation({ ...locator, body, fetcher }), method === "GET" ? /READ_UNAVAILABLE/ : /OUTCOME_UNKNOWN/);
    assert.equal(calls, 1);
  }
});

test("bad status, correlation, JSON, bounds and lost response fail without retry or legacy fallback", async () => {
  const replies = [() => reply(result, 201), () => reply(result, 403), () => reply({ status: "NOT_FOUND" }),
    () => Response.json({ success: true, requestId: uuid, correlationId: other, data: result }),
    () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    () => new Response(" ".repeat(5121), { headers: { "content-type": "application/json" } }),
    () => { throw new Error("PRIVATE_TOKEN"); }];
  for (const makeReply of replies) {
    let calls = 0;
    await assert.rejects(sendHtmlEditingInitializationOperation({ ...locator, body, fetcher: async () => { calls++; return makeReply(); } }),
      error => error instanceof Error && /OUTCOME_UNKNOWN/.test(error.message) && !/PRIVATE_TOKEN/.test(error.message));
    assert.equal(calls, 1);
  }
});
