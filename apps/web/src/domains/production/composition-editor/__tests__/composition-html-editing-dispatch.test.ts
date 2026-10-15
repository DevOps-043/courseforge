import test from "node:test";
import assert from "node:assert/strict";
import { dispatchTrackedHtmlEditingMutation, HtmlEditingDispatchError } from "../composition-html-editing-dispatch.client";
import { readHtmlEditingJournal, beginHtmlEditingJournal } from "../composition-html-editing-journal.client";
import { CompositionSaveQueue } from "../composition-save-queue";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid } from "./composition-html-editing-test-fixtures";

function setup() {
  const source = fixture(), entries = new Map<string, string>();
  const scope = { actorId: uuid, organizationId: source.request.scope.organizationId, draftId: source.request.scope.documentId };
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); } };
  const queue = new CompositionSaveQueue<number>(async () => true);
  const body = { action: "COMMAND" as const, expected: { version: 1, sha256: source.current.sha256 },
    expectedCompositionDocumentHash: source.row.compositionDocumentHash,
    overrides: [{ operation: "SET_TEXT" as const, elementId: "title", value: "Changed" }] };
  const ack = { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED" as const, changed: true,
    previous: body.expected, next: { version: 2, sha256: source.next.sha256 } };
  const counters = { dispatch: 0, rebase: 0 };
  const params = { scope, clipId: source.request.scope.clipId, body, storage,
    lock: { runExclusive: async <T>(_scope: typeof scope, task: () => Promise<T>) => task() },
    reserveNative: <T>(task: () => Promise<T>) => queue.runExclusiveWhenIdle(task),
    isCurrentAndEditable: () => true, createOperationId: () => uuid,
    fetcher: (async () => { counters.dispatch++; assert.equal(readHtmlEditingJournal(storage, scope).status, "PENDING");
      assert.equal(queue.snapshot().status, "RUNNING");
      return Response.json({ success: true, data: ack, requestId: uuid, correlationId: uuid }); }) as typeof fetch,
    rebase: async () => { counters.rebase++; const state = readHtmlEditingJournal(storage, scope);
      assert.equal(state.status, "PENDING"); if (state.status === "PENDING") assert.deepEqual(state.entry.acknowledgment, ack);
      assert.equal(queue.snapshot().status, "RUNNING"); return true; } };
  return { params, scope, storage, queue, ack, counters };
}
const code = (expected: HtmlEditingDispatchError["code"]) => (error: unknown) => error instanceof HtmlEditingDispatchError
  && error.code === expected && !error.automaticRetryAllowed;

test("coordinator holds reservation through persist, single POST, ACK and rebase before close", async () => {
  const f = setup(); assert.deepEqual(await dispatchTrackedHtmlEditingMutation(f.params), f.ack);
  assert.deepEqual(f.counters, { dispatch: 1, rebase: 1 });
  assert.equal(readHtmlEditingJournal(f.storage, f.scope).status, "EMPTY"); assert.equal(f.queue.snapshot().status, "IDLE");
});

test("missing/contended lock, denied storage, invalid request and stale admission do not dispatch", async () => {
  for (const overrides of [{ lock: null }, { storage: null }, { isCurrentAndEditable: () => false },
    { lock: { runExclusive: async () => { throw new Error("busy"); } } },
    { clipId: "../invalid" }, { createOperationId: () => "invalid" }]) {
    const f = setup(); await assert.rejects(dispatchTrackedHtmlEditingMutation({ ...f.params, ...overrides }), code("NOT_DISPATCHED"));
    assert.equal(f.counters.dispatch, 0); assert.equal(f.queue.snapshot().status, "IDLE");
  }
});

test("existing pending journal blocks another mutation without retries or overwriting", async () => {
  const f = setup(); beginHtmlEditingJournal(f.storage, { scope: f.scope, clipId: f.params.clipId, operationId: uuid,
    createdAt: 1, expected: f.params.body.expected, expectedCompositionDocumentHash: f.params.body.expectedCompositionDocumentHash });
  await assert.rejects(dispatchTrackedHtmlEditingMutation(f.params), code("PENDING_OPERATION"));
  assert.equal(f.counters.dispatch, 0); assert.equal(readHtmlEditingJournal(f.storage, f.scope).status, "PENDING");
});

test("lost POST acknowledgment retains journal, reports uncertainty and never rebases or retries", async () => {
  const f = setup(); let calls = 0;
  await assert.rejects(dispatchTrackedHtmlEditingMutation({ ...f.params, fetcher: async () => { calls++; throw new Error("PRIVATE_SECRET"); } }), code("OUTCOME_UNKNOWN"));
  assert.equal(calls, 1); assert.equal(f.counters.rebase, 0);
  assert.equal(readHtmlEditingJournal(f.storage, f.scope).status, "PENDING");
  await assert.rejects(dispatchTrackedHtmlEditingMutation(f.params), code("PENDING_OPERATION"));
  assert.equal(f.counters.dispatch, 0);
});

test("confirmed POST with failed or context-drifting rebase retains ACK and requires refresh", async () => {
  for (const drift of [false, true]) {
    const f = setup(); let current = true;
    await assert.rejects(dispatchTrackedHtmlEditingMutation({ ...f.params, isCurrentAndEditable: () => current,
      rebase: async () => { if (drift) current = false; return drift; } }), code("REFRESH_REQUIRED"));
    const state = readHtmlEditingJournal(f.storage, f.scope);
    assert.equal(state.status, "PENDING"); if (state.status === "PENDING") assert.deepEqual(state.entry.acknowledgment, f.ack);
    assert.equal(f.queue.snapshot().status, "IDLE");
  }
});

test("abort bounds waiting for non-cooperative POST and safely observes its late failure", async () => {
  const f = setup(), controller = new AbortController(); let rejectLate!: (error: Error) => void, began!: () => void;
  const dispatched = new Promise<void>(resolve => { began = resolve; });
  const task = dispatchTrackedHtmlEditingMutation({ ...f.params, signal: controller.signal,
    fetcher: async () => { began(); return new Promise<Response>((_resolve, reject) => { rejectLate = reject; }); } });
  await dispatched; controller.abort(); await assert.rejects(task, code("OUTCOME_UNKNOWN"));
  assert.equal(readHtmlEditingJournal(f.storage, f.scope).status, "PENDING");
  assert.equal(f.queue.snapshot().status, "IDLE"); rejectLate(new Error("late"));
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(f.counters.rebase, 0);
});

test("failure to persist a valid ACK cannot claim completion or delete the pending record", async () => {
  const f = setup(); let writes = 0;
  await assert.rejects(dispatchTrackedHtmlEditingMutation({ ...f.params, storage: { ...f.storage,
    setItem: (key, value) => { if (++writes > 1) throw new Error("quota"); f.storage.setItem(key, value); } } }), code("OUTCOME_UNKNOWN"));
  assert.equal(f.counters.dispatch, 1); assert.equal(f.counters.rebase, 0);
  const state = readHtmlEditingJournal(f.storage, f.scope); assert.equal(state.status, "PENDING");
  if (state.status === "PENDING") assert.equal(state.entry.acknowledgment, undefined);
});

test("abort during a non-cooperative rebase keeps confirmed tracking and never clears it later", async () => {
  const f = setup(), controller = new AbortController(); let finishLate!: (value: boolean) => void, began!: () => void;
  const rebasing = new Promise<void>(resolve => { began = resolve; });
  const task = dispatchTrackedHtmlEditingMutation({ ...f.params, signal: controller.signal,
    rebase: async () => { began(); return new Promise<boolean>(resolve => { finishLate = resolve; }); } });
  await rebasing; controller.abort(); await assert.rejects(task, code("REFRESH_REQUIRED"));
  finishLate(true); await new Promise<void>(resolve => setImmediate(resolve));
  const state = readHtmlEditingJournal(f.storage, f.scope); assert.equal(state.status, "PENDING");
  if (state.status === "PENDING") assert.deepEqual(state.entry.acknowledgment, f.ack);
});
