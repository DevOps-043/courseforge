import test from "node:test";
import assert from "node:assert/strict";
import { consultHtmlEditingInspector, sendHtmlEditingMutation } from "../composition-html-editing-http.client";
import { HtmlEditingEditorialHistory } from "../composition-html-editing-history.client";
import { readBoundedCompositionJson } from "../composition-bounded-json-response.client";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const input = fixture();
  const scope = input.request.scope;
  const view = createHtmlEditingInspectorView({ ...input.authority, encodedRevision: JSON.stringify(input.current.revision), compositionDocumentHash: input.row.compositionDocumentHash });
  const next = createHtmlEditingInspectorView({ ...input.authority, encodedRevision: JSON.stringify(input.next.revision), compositionDocumentHash: "b".repeat(64) });
  const body = { action: "COMMAND" as const, expected: { version: 1, sha256: input.current.sha256 },
    expectedCompositionDocumentHash: input.row.compositionDocumentHash, overrides: [{ operation: "SET_TEXT" as const, elementId: "title", value: "Changed" }] };
  const ack = { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED" as const, changed: true,
    previous: body.expected, next: { version: 2, sha256: input.next.sha256 } };
  const envelope = (data: unknown) => Response.json({ success: true, data, requestId: uuid, correlationId: uuid });
  return { input, scope, view, next, body, ack, envelope };
}
test("client GET validates owner scope and sends only same-origin no-store request", async () => {
  const f = setup();
  const result = await consultHtmlEditingInspector({ scope: f.scope, fetcher: async (url, options) => {
    assert.equal(url, `/api/production/hyperframes/drafts/${uuid}/html-editing/${f.scope.clipId}`);
    assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    return f.envelope(f.view);
  } });
  assert.equal(result.revisionSha256, f.view.revisionSha256);
  await assert.rejects(consultHtmlEditingInspector({ scope: { ...f.scope, organizationId: other }, fetcher: async () => f.envelope(f.view) }), /READ_UNAVAILABLE/);
});
test("client POST validates CAS ACK and dispatches no source, grants or owner claims", async () => {
  const f = setup(); let calls = 0;
  const result = await sendHtmlEditingMutation({ scope: f.scope, body: f.body, fetcher: async (_url, options) => {
    calls++; assert.deepEqual(JSON.parse(String(options?.body)), f.body); assert.equal(options?.method, "POST"); return f.envelope(f.ack);
  } });
  assert.equal(calls, 1); assert.deepEqual(result, f.ack);
});
test("invalid and pre-cancelled mutations never dispatch; dispatched errors are uncertain and never retried", async () => {
  const f = setup(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("PRIVATE_TOKEN"); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sendHtmlEditingMutation({ scope: f.scope, body: f.body, fetcher, signal: controller.signal }), /INVALID_REQUEST/);
  assert.equal(calls, 0);
  await assert.rejects(sendHtmlEditingMutation({ scope: f.scope, body: f.body, fetcher }), /OUTCOME_UNKNOWN/); assert.equal(calls, 1);
  await assert.rejects(sendHtmlEditingMutation({ scope: f.scope, body: f.body, fetcher: async () => f.envelope({ ...f.ack, previous: { version: 1, sha256: "f".repeat(64) } }) }), /OUTCOME_UNKNOWN/);
});
test("bounded decoder rejects overflow and invalid UTF-8 and cancels its stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedCompositionJson(new Response(stream, { headers: { "content-type": "application/json" } }), 10, new AbortController().signal));
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedCompositionJson(new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), 10, new AbortController().signal));
});
test("history requires server refresh after confirmation and restores old content at new locators", () => {
  const f = setup(), history = new HtmlEditingEditorialHistory({ ...f.scope, actorId: uuid });
  history.observe(f.view, uuid); assert.deepEqual(history.beginCommand().expected, f.body.expected);
  history.confirm(f.ack); assert.equal(history.snapshot().status, "REFRESH_REQUIRED"); assert.equal(history.snapshot().canUndo, false);
  history.observe(f.next, uuid); assert.equal(history.snapshot().canUndo, true);
  const undo = history.beginRestore("UNDO"); assert.equal(undo.action, "RESTORE");
  if (undo.action === "RESTORE") assert.deepEqual(undo.restore, f.body.expected);
  const undone = { version: 3, sha256: "c".repeat(64) };
  history.confirm({ ...f.ack, previous: f.ack.next, next: undone });
  history.observe({ ...f.view, revisionVersion: 3, revisionSha256: undone.sha256 }, uuid);
  const redo = history.beginRestore("REDO"); if (redo.action === "RESTORE") assert.deepEqual(redo.restore, f.ack.next);
});
test("uncertain writes freeze history and explicit read discards attribution instead of confirming a matching write", () => {
  const f = setup(), history = new HtmlEditingEditorialHistory({ ...f.scope, actorId: uuid });
  history.observe(f.view, uuid); history.beginCommand(); history.markUncertain();
  assert.equal(history.snapshot().status, "UNCERTAIN"); assert.throws(() => history.beginCommand(), /NOT_READY/);
  history.observe(f.next, uuid); assert.equal(history.snapshot().undoCount, 0); assert.equal(history.snapshot().status, "READY");
});
test("foreign owner, external revision drift and malformed ACK cannot corrupt history", () => {
  const f = setup(), history = new HtmlEditingEditorialHistory({ ...f.scope, actorId: uuid });
  assert.throws(() => history.observe(f.view, other), /SCOPE_OR_PENDING/);
  history.observe(f.view, uuid); history.beginCommand(); history.confirm(f.ack); history.observe(f.next, uuid);
  history.observe({ ...f.next, revisionVersion: 5, revisionSha256: "f".repeat(64) }, uuid); assert.equal(history.snapshot().undoCount, 0);
  history.beginCommand(); assert.throws(() => history.confirm(f.ack), /ACK_MISMATCH/); assert.equal(history.snapshot().status, "PENDING");
});
