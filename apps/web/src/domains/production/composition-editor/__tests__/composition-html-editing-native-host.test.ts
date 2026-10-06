import test from "node:test";
import assert from "node:assert/strict";
import { CompositionHtmlEditorialNativeHost } from "../composition-html-editing-native-host.client";
import { readHtmlEditingJournal, beginHtmlEditingJournal, acknowledgeHtmlEditingJournal, recordHtmlEditingJournalReceipt } from "../composition-html-editing-journal.client";
import { hashCompositionDocumentInBrowser } from "../composition-recovery-journal";
import { readHtmlEditingInitializationJournal, beginHtmlEditingInitializationJournal } from "../composition-html-editing-initialization-journal.client";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { computeHtmlEditingOperationRequestSha256 } from "../composition-html-editing-operation-digest.server";
import { CompositionSaveQueue } from "../composition-save-queue";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup() {
  const f = fixture(), entries = new Map<string, string>();
  const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
  const base = { document: f.document, documentHash: f.row.compositionDocumentHash, version: 4 };
  const saved = bindHtmlEditingRevisionToComposition({ ...f.authority, document: base.document, revision: f.next.revision, revisionSha256: f.next.sha256 });
  const candidate = { ...saved, version: 5 };
  const beforeView = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(f.current.revision), compositionDocumentHash: base.documentHash });
  const afterView = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(f.next.revision), compositionDocumentHash: candidate.documentHash });
  const acknowledgment = { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED" as const, changed: true,
    previous: { version: 1, sha256: f.current.sha256 }, next: { version: 2, sha256: f.next.sha256 } };
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const state = { scope, payload: base, enabled: true, conflicting: false, adoptCount: 0, requests: 0, busy: [] as boolean[] };
  const queue = new CompositionSaveQueue<number>(async () => true);
  const input = { scope, clipId: f.request.scope.clipId, beforeView, signal: new AbortController().signal,
    body: { action: "COMMAND" as const, expected: acknowledgment.previous, expectedCompositionDocumentHash: base.documentHash,
      overrides: [{ operation: "SET_TEXT" as const, elementId: "title", value: "Changed" }] } };
  const fetcher: typeof fetch = async (_url, options) => {
    state.requests++; assert.equal(queue.snapshot().status, "RUNNING");
    return Response.json({ success: true, requestId: uuid, correlationId: uuid,
      data: options?.method === "POST" ? acknowledgment : String(_url).endsWith("/document") ? candidate : afterView });
  };
  const ports = { enabled: () => state.enabled, getScope: () => state.scope, getPayload: () => state.payload,
    hasConflictingWork: (reserved: boolean) => state.conflicting || (!reserved && queue.snapshot().status !== "IDLE"),
    reserve: <T>(task: () => Promise<T>) => queue.runExclusiveWhenIdle(task), getStorage: () => storage,
    getLock: () => ({ runExclusive: async <T>(_scope: typeof scope, task: () => Promise<T>) => task() }),
    onBusyChange: (busy: boolean) => { state.busy.push(busy); },
    adopt: (payload: typeof base) => { state.adoptCount++; state.payload = payload; }, fetcher, createOperationId: () => uuid };
  return { input, base, candidate, beforeView, afterView, acknowledgment, ports, state, queue, storage, entries };
}

function pending(f: ReturnType<typeof setup>, acknowledgment: unknown = f.acknowledgment) {
  assert.equal(beginHtmlEditingJournal(f.storage, { scope: f.input.scope, operationId: uuid, clipId: f.input.clipId,
    createdAt: 1, expected: f.acknowledgment.previous, expectedCompositionDocumentHash: f.base.documentHash }), true);
  if (acknowledgment) assert.equal(acknowledgeHtmlEditingJournal(f.storage, f.input.scope, uuid, acknowledgment), true);
}

function durablePending(f: ReturnType<typeof setup>) {
  const requestSha256 = computeHtmlEditingOperationRequestSha256(f.input.body);
  assert.equal(beginHtmlEditingJournal(f.storage, { scope: f.input.scope, operationId: uuid, clipId: f.input.clipId,
    createdAt: 1, expected: f.acknowledgment.previous, expectedCompositionDocumentHash: f.base.documentHash, requestSha256 }), true);
  return { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const, owner: f.input.scope,
    operationId: uuid, requestSha256, clipId: f.input.clipId, acknowledgment: f.acknowledgment };
}

test("draft historical recovery still verifies receipt when its clip was removed or its HTML replaced", async () => {
  for (const change of ["removed", "replaced"] as const) {
    const f = setup(), receipt = durablePending(f);
    const document = compositionEditorDocumentSchema.parse({ ...f.base.document, sourceInsertionMode: "MANUAL",
      clips: change === "removed" ? [] : f.base.document.clips.map(clip => clip.source.type === "DECK_SLIDE"
        ? { ...clip, source: { ...clip.source, html: "<div>Replacement HTML</div>" } } : clip) });
    const loaded = { document, documentHash: await hashCompositionDocumentInBrowser(document), version: 8 };
    f.state.payload = loaded; let calls = 0;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, enabled: () => false, fetcher: async (url, options) => {
      calls++; assert.equal(options?.method, "GET");
      assert.ok(String(url).includes("/operations/") || String(url).endsWith("/document"));
      return Response.json({ success: true, requestId: uuid, correlationId: uuid,
        data: String(url).includes("/operations/") ? { status: "RECORDED", receipt } : loaded });
    } });
    await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal, historicalOnly: true });
    assert.equal(calls, 2); assert.equal(f.state.payload, loaded); assert.equal(f.state.adoptCount, 0); assert.equal(host.isBlocked(), false);
  }
});

test("unknown initialization remains inspectable and blocked without its original clip; no GET proves missing ACK", async () => {
  const f = initializationFixture();
  assert.equal(beginHtmlEditingInitializationJournal(f.storage, { scope: f.input.scope, operationId: uuid, clipId: f.input.clipId,
    createdAt: 1, request: f.initializationInput.action.body }), true);
  const document = compositionEditorDocumentSchema.parse({ ...f.base.document, sourceInsertionMode: "MANUAL", clips: [] });
  f.state.payload = { document, documentHash: await hashCompositionDocumentInBrowser(document), version: 8 };
  const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, enabled: () => false, initializationEnabled: () => false });
  const tracking = host.initializationTracking(f.input.scope); assert.equal(tracking.status, "PENDING");
  if (tracking.status === "PENDING") assert.equal(tracking.entry.clipId, f.input.clipId);
  await assert.rejects(host.initialize({ scope: f.input.scope, signal: f.input.signal, action: { mode: "RECOVER", operationId: uuid } }), /ACK_REQUIRED/);
  assert.equal(f.state.requests, 0); assert.equal(host.isBlocked(), true);
});

function initializationFixture() {
  const f = setup(), binding = f.beforeView.manifest.binding;
  const body = { templateId: binding.templateId, templateVersion: binding.templateVersion, expectedDocumentHash: f.base.documentHash };
  const ack = { status: "CONFIRMED", created: true, version: 1, sha256: f.beforeView.revisionSha256, compositionDocumentHash: f.base.documentHash };
  const input = { scope: f.input.scope, signal: f.input.signal, action: { mode: "SEND" as const, clipId: f.input.clipId, body } };
  const fetcher: typeof fetch = async (url, options) => {
    f.state.requests++; assert.equal(f.queue.snapshot().status, "RUNNING");
    if (options?.method === "POST") assert.equal(readHtmlEditingInitializationJournal(f.storage, f.input.scope).status, "PENDING");
    return Response.json({ success: true, requestId: uuid, correlationId: uuid,
      data: options?.method === "POST" ? ack : String(url).endsWith("/document") ? f.base : f.beforeView },
    { status: options?.method === "POST" ? 201 : 200 });
  };
  return { ...f, initializationInput: input, initialAck: ack, initialPorts: { ...f.ports, initializationEnabled: () => true, fetcher } };
}

test("native initialization tracks before single POST, verifies two GETs and leaves document/history untouched", async () => {
  const f = initializationFixture(), host = new CompositionHtmlEditorialNativeHost(f.initialPorts);
  const view = await host.initialize(f.initializationInput);
  assert.deepEqual(view, f.beforeView); assert.equal(f.state.requests, 3); assert.equal(f.state.adoptCount, 0);
  assert.equal(f.state.payload, f.base); assert.equal(host.isBlocked(), false);
  assert.equal(host.initializationTracking(f.input.scope).status, "EMPTY"); assert.deepEqual(f.state.busy, [true, false]);
});

test("initialization admission rejects disabled flag, conflicting work, editorial tracking or missing lock/storage without POST", async () => {
  for (const failure of ["disabled", "work", "editorial", "lock", "storage"] as const) {
    const f = initializationFixture();
    if (failure === "work") f.state.conflicting = true;
    if (failure === "editorial") pending(f);
    const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts,
      initializationEnabled: () => failure !== "disabled", getLock: () => failure === "lock" ? null : f.ports.getLock(),
      getStorage: () => failure === "storage" ? null : f.storage });
    await assert.rejects(host.initialize(f.initializationInput), /NOT_READY/); assert.equal(f.state.requests, 0);
  }
});

test("lost initialization response freezes subsequent native/editorial writes across reload even with flags disabled", async () => {
  const f = initializationFixture(); let calls = 0;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher: async () => { calls++; throw new Error("lost"); } });
  await assert.rejects(host.initialize(f.initializationInput), /OUTCOME_UNKNOWN/);
  assert.equal(host.isBlocked(), true); assert.equal(calls, 1);
  const reloaded = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, enabled: () => false, initializationEnabled: () => false });
  assert.equal(reloaded.isBlocked(), true);
  await assert.rejects(reloaded.initialize({ scope: f.input.scope, signal: f.input.signal, action: { mode: "RECOVER", operationId: uuid } }), /ACK_REQUIRED/);
  await assert.rejects(reloaded.execute(f.input), /NOT_READY/);
  await assert.rejects(reloaded.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /NOT_READY/);
  assert.equal(f.state.requests, 0); assert.equal(reloaded.initializationTracking(f.input.scope).status, "PENDING");
});

test("initial ACK survives failed refresh and explicit recovery performs only two GETs with writes disabled", async () => {
  const f = initializationFixture(); let failRefresh = true, posts = 0;
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method === "POST") posts++;
    else if (failRefresh) throw new Error("refresh unavailable");
    return f.initialPorts.fetcher(url, options);
  };
  const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher });
  await assert.rejects(host.initialize(f.initializationInput), /REFRESH_REQUIRED/);
  const tracking = host.initializationTracking(f.input.scope); assert.equal(tracking.status, "PENDING");
  if (tracking.status === "PENDING") assert.deepEqual(tracking.entry.acknowledgment, f.initialAck);
  failRefresh = false;
  const reloaded = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher, enabled: () => false, initializationEnabled: () => false });
  await reloaded.initialize({ scope: f.input.scope, signal: f.input.signal, action: { mode: "RECOVER", operationId: uuid } });
  assert.equal(posts, 1); assert.equal(f.state.requests, 3); assert.equal(reloaded.isBlocked(), false); assert.equal(f.state.adoptCount, 0);
});

test("initialization inspector template/hash/revision/source tampering cannot close directly acknowledged tracking", async () => {
  for (const failure of ["template", "revision", "sha", "source"] as const) {
    const f = initializationFixture();
    const view = failure === "revision" ? { ...f.beforeView, revisionVersion: 2 }
      : failure === "sha" ? { ...f.beforeView, revisionSha256: "d".repeat(64) }
        : { ...f.beforeView, manifest: { ...f.beforeView.manifest, binding: { ...f.beforeView.manifest.binding,
          ...(failure === "template" ? { templateId: "another-template" } : { sourceSha256: "d".repeat(64) }) } },
          state: { ...f.beforeView.state, binding: { ...f.beforeView.state.binding,
            ...(failure === "template" ? { templateId: "another-template" } : { sourceSha256: "d".repeat(64) }) } } };
    const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher: async (url, options) => {
      if (options?.method === "POST" || String(url).endsWith("/document")) return f.initialPorts.fetcher(url, options);
      return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: view });
    } });
    await assert.rejects(host.initialize(f.initializationInput));
    assert.equal(host.initializationTracking(f.input.scope).status, "PENDING"); assert.equal(host.isBlocked(), true); assert.equal(f.state.adoptCount, 0);
  }
});

test("initialization stale native version/hash and changed source remain blocked without adopting refresh", async () => {
  for (const candidate of [initializationFixture().candidate, { ...initializationFixture().base, version: 99 }]) {
    const f = initializationFixture();
    const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher: async (url, options) => String(url).endsWith("/document")
      ? Response.json({ success: true, requestId: uuid, correlationId: uuid, data: candidate }) : f.initialPorts.fetcher(url, options) });
    await assert.rejects(host.initialize(f.initializationInput), /REFRESH_REQUIRED/);
    assert.equal(f.state.payload, f.base); assert.equal(f.state.adoptCount, 0); assert.equal(host.isBlocked(), true);
  }
});

test("initialization owner/base/tracking drift during POST or GET cannot record late ACK or close", async () => {
  for (const phase of ["POST", "GET"] as const) for (const drift of ["owner", "base", "tracking"] as const) {
    const f = initializationFixture(); let drifted = false;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher: async (url, options) => {
      const response = await f.initialPorts.fetcher(url, options);
      if (!drifted && options?.method === phase) {
        drifted = true;
        if (drift === "owner") f.state.scope = { ...f.input.scope, actorId: other };
        else if (drift === "base") f.state.payload = { ...f.base };
        else { const key = [...f.entries.keys()][0]!; const entry = JSON.parse(f.entries.get(key)!); f.entries.set(key, JSON.stringify({ ...entry, createdAt: 7 })); }
      }
      return response;
    } });
    await assert.rejects(host.initialize(f.initializationInput), /TRACKING_CHANGED/);
    const tracking = readHtmlEditingInitializationJournal(f.storage, f.input.scope); assert.equal(tracking.status, "PENDING");
    if (tracking.status === "PENDING" && phase === "POST") assert.equal(tracking.entry.acknowledgment, undefined);
    assert.equal(f.state.adoptCount, 0);
  }
});

test("aborting noncooperative initial POST frees reservation and late ACK cannot erase unknown tracking", async () => {
  const f = initializationFixture(), controller = new AbortController();
  let resolveRead!: (response: Response) => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const host = new CompositionHtmlEditorialNativeHost({ ...f.initialPorts, fetcher: async () => {
    started(); return await new Promise<Response>(resolve => { resolveRead = resolve; });
  } });
  const operation = host.initialize({ ...f.initializationInput, signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(operation, /OUTCOME_UNKNOWN/);
  assert.equal(f.queue.snapshot().status, "IDLE"); assert.equal(host.isBusy(), false);
  resolveRead(Response.json({ success: true, requestId: uuid, correlationId: uuid, data: f.initialAck }, { status: 201 }));
  await new Promise<void>(resolve => setImmediate(resolve));
  const tracking = host.initializationTracking(f.input.scope); assert.equal(tracking.status, "PENDING");
  if (tracking.status === "PENDING") assert.equal(tracking.entry.acknowledgment, undefined);
  assert.equal(host.isBlocked(), true);
});

test("unknown initialization tracking blocks editorial recovery and is never overwritten by another initial attempt", async () => {
  const f = initializationFixture();
  assert.equal(beginHtmlEditingInitializationJournal(f.storage, { scope: f.input.scope, operationId: uuid, clipId: f.input.clipId,
    createdAt: 1, request: f.initializationInput.action.body }), true);
  const encoded = [...f.entries.values()][0]; const host = new CompositionHtmlEditorialNativeHost(f.initialPorts);
  await assert.rejects(host.initialize(f.initializationInput), /NOT_READY/);
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /NOT_READY/);
  assert.equal([...f.entries.values()][0], encoded); assert.equal(f.state.requests, 0);
});

test("explicit historical closure verifies superseded receipt without restoring its revision or reading inspector", async () => {
  const f = setup(), receipt = durablePending(f);
  const document = { ...f.candidate.document, htmlEditing: { ...f.candidate.document.htmlEditing!,
    items: f.candidate.document.htmlEditing!.items.map(item => ({ ...item, revisionVersion: 3, revisionSha256: "b".repeat(64) })) } };
  const latest = { document, documentHash: await hashCompositionDocumentInBrowser(document), version: 6 };
  f.state.payload = latest; f.state.enabled = false;
  const urls: string[] = [];
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
    assert.equal(options?.method, "GET"); assert.equal(f.queue.snapshot().status, "RUNNING"); urls.push(String(url));
    assert.ok(String(url).includes("/operations/") || String(url).endsWith("/document"));
    return Response.json({ success: true, requestId: uuid, correlationId: uuid,
      data: String(url).includes("/operations/") ? { status: "RECORDED", receipt } : latest });
  } });
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal, historicalOnly: true });
  assert.equal(urls.length, 2); assert.equal(host.isBlocked(), false);
  assert.equal(f.state.payload, latest); assert.equal(f.state.adoptCount, 0); assert.equal(f.queue.snapshot().status, "IDLE");
});

test("historical closure reauthorizes even a cached receipt and preserves it when authorization fails", async () => {
  for (const outcome of ["NOT_FOUND", "DENIED", "FOREIGN"] as const) {
    const f = setup(), receipt = durablePending(f);
    assert.equal(recordHtmlEditingJournalReceipt(f.storage, f.input.scope, uuid, receipt), true);
    const encoded = [...f.entries.values()][0]; let calls = 0;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
      calls++;
      return outcome === "DENIED" ? new Response(null, { status: 403 }) : Response.json({ success: true, requestId: uuid, correlationId: uuid,
        data: outcome === "NOT_FOUND" ? { status: "NOT_FOUND" }
          : { status: "RECORDED", receipt: { ...receipt, owner: { ...receipt.owner, actorId: other } } } });
    } });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal, historicalOnly: true }));
    assert.equal(calls, 1); assert.equal([...f.entries.values()][0], encoded); assert.equal(host.isBlocked(), true);
  }
});

test("historical closure refuses legacy ACK without durable identity before any request", async () => {
  const f = setup(); pending(f); const host = new CompositionHtmlEditorialNativeHost(f.ports);
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal, historicalOnly: true }), /ACK_REQUIRED/);
  assert.equal(f.state.requests, 0); assert.equal(host.isBlocked(), true);
});

test("historical closure requires explicitly loaded authoritative native hash and version", async () => {
  for (const mismatch of ["stale", "version", "integrity"] as const) {
    const f = setup(), receipt = durablePending(f);
    const candidate = mismatch === "version" ? { ...f.base, version: 5 }
      : mismatch === "integrity" ? { ...f.base, documentHash: "c".repeat(64) } : f.candidate;
    if (mismatch === "integrity") f.state.payload = candidate;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async url => Response.json({ success: true,
      requestId: uuid, correlationId: uuid, data: String(url).includes("/operations/") ? { status: "RECORDED", receipt } : candidate }) });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal, historicalOnly: true }), /RELOAD_REQUIRED/);
    assert.equal(host.isBlocked(), true); assert.equal(f.state.adoptCount, 0);
    const tracking = host.tracking(f.input.scope); assert.equal(tracking.status, "PENDING");
    if (tracking.status === "PENDING") assert.deepEqual(tracking.entry.receipt, receipt);
  }
});

test("historical closure fences owner/base/tracking changes during native verification", async () => {
  for (const drift of ["owner", "base", "tracking"] as const) {
    const f = setup(), receipt = durablePending(f); f.state.payload = f.candidate;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async url => {
      if (String(url).includes("/operations/")) return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } });
      if (drift === "owner") f.state.scope = { ...f.input.scope, actorId: other };
      else if (drift === "base") f.state.payload = { ...f.candidate };
      else { const key = [...f.entries.keys()][0]!; const entry = JSON.parse(f.entries.get(key)!); f.entries.set(key, JSON.stringify({ ...entry, createdAt: 7 })); }
      return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: f.candidate });
    } });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal, historicalOnly: true }), /TRACKING_CHANGED/);
    assert.equal(readHtmlEditingJournal(f.storage, f.input.scope).status, "PENDING"); assert.equal(f.state.adoptCount, 0);
  }
});

test("historical native read abort cannot close tracking after late response", async () => {
  const f = setup(), receipt = durablePending(f), controller = new AbortController(); f.state.payload = f.candidate;
  let resolveRead!: (response: Response) => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async url => {
    if (String(url).includes("/operations/")) return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } });
    started(); return await new Promise<Response>(resolve => { resolveRead = resolve; });
  } });
  const recovery = host.recover({ scope: f.input.scope, operationId: uuid, signal: controller.signal, historicalOnly: true });
  await ready; controller.abort(); await assert.rejects(recovery);
  resolveRead(Response.json({ success: true, requestId: uuid, correlationId: uuid, data: f.candidate }));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(host.isBlocked(), true); assert.equal(f.state.adoptCount, 0); assert.equal(f.queue.snapshot().status, "IDLE");
});

test("missing durable ACK recovers through one receipt GET and two current reads without any POST or adoption", async () => {
  const f = setup(), receipt = durablePending(f); f.state.payload = f.candidate; f.state.enabled = false;
  let receiptReads = 0;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
    assert.equal(options?.method, "GET");
    if (String(url).includes("/operations/")) {
      receiptReads++; assert.equal(f.queue.snapshot().status, "RUNNING");
      return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } });
    }
    return f.ports.fetcher(url, options);
  } });
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.equal(receiptReads, 1); assert.equal(f.state.requests, 2); assert.equal(f.state.adoptCount, 0);
  assert.equal(host.isBlocked(), false); assert.equal(f.state.payload, f.candidate); assert.equal(f.queue.snapshot().status, "IDLE");
});

test("NOT_FOUND receipt preserves unknown tracking exactly, with no current read or retry", async () => {
  const f = setup(); durablePending(f); const encoded = [...f.entries.values()][0]; let calls = 0;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
    calls++; return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "NOT_FOUND" } });
  } });
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /RECEIPT_NOT_FOUND/);
  assert.equal(calls, 1); assert.equal([...f.entries.values()][0], encoded); assert.equal(host.isBlocked(), true);
});

test("foreign receipt or wrong expected ACK cannot be persisted or inferred from saved content", async () => {
  for (const failure of ["owner", "digest", "previous"] as const) {
    const f = setup(), original = durablePending(f), encoded = [...f.entries.values()][0];
    const receipt = failure === "owner" ? { ...original, owner: { ...original.owner, actorId: other } }
      : failure === "digest" ? { ...original, requestSha256: "f".repeat(64) }
        : { ...original, acknowledgment: { ...original.acknowledgment, previous: { version: 3, sha256: "d".repeat(64) }, next: { version: 4, sha256: "e".repeat(64) } } };
    let calls = 0;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
      calls++; return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } });
    } });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }));
    assert.equal(calls, 1); assert.equal([...f.entries.values()][0], encoded); assert.equal(f.state.adoptCount, 0);
  }
});

test("valid causal receipt survives stale local payload and closes only after explicit reload", async () => {
  const f = setup(), receipt = durablePending(f); let receiptReads = 0;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
    if (String(url).includes("/operations/")) {
      receiptReads++; return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } });
    }
    return f.ports.fetcher(url, options);
  } });
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /RELOAD_REQUIRED/);
  const tracking = host.tracking(f.input.scope); assert.equal(tracking.status, "PENDING");
  if (tracking.status === "PENDING") assert.deepEqual(tracking.entry.receipt, receipt);
  assert.equal(f.state.payload, f.base); f.state.payload = f.candidate;
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.equal(receiptReads, 1); assert.equal(host.isBlocked(), false); assert.equal(f.state.adoptCount, 0);
});

test("owner/base/tracking drift during receipt lookup prevents even recording a received ACK", async () => {
  for (const drift of ["owner", "base", "tracking"] as const) {
    const f = setup(), receipt = durablePending(f); let calls = 0;
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
      calls++;
      if (drift === "owner") f.state.scope = { ...f.input.scope, actorId: other };
      else if (drift === "base") f.state.payload = { ...f.base };
      else { const key = [...f.entries.keys()][0]!; const entry = JSON.parse(f.entries.get(key)!); f.entries.set(key, JSON.stringify({ ...entry, createdAt: 7 })); }
      return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } });
    } });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /TRACKING_CHANGED/);
    const tracking = readHtmlEditingJournal(f.storage, f.input.scope); assert.equal(tracking.status, "PENDING");
    if (tracking.status === "PENDING") assert.equal(tracking.entry.acknowledgment, undefined);
    assert.equal(calls, 1); assert.equal(f.state.adoptCount, 0);
  }
});

test("noncooperative missing-ACK receipt lookup aborts without late journal recording or stuck native reservation", async () => {
  const f = setup(), receipt = durablePending(f), controller = new AbortController();
  let resolveRead!: (response: Response) => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
    started(); return await new Promise<Response>(resolve => { resolveRead = resolve; });
  } });
  const recovery = host.recover({ scope: f.input.scope, operationId: uuid, signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(recovery);
  assert.equal(f.queue.snapshot().status, "IDLE");
  resolveRead(Response.json({ success: true, requestId: uuid, correlationId: uuid, data: { status: "RECORDED", receipt } }));
  await new Promise<void>(resolve => setImmediate(resolve));
  const tracking = host.tracking(f.input.scope); assert.equal(tracking.status, "PENDING");
  if (tracking.status === "PENDING") assert.equal(tracking.entry.acknowledgment, undefined);
  assert.equal(host.isBlocked(), true);
});

test("missing-ACK no-op receipt closes exact initial hash without native version or pointer changes", async () => {
  const f = setup();
  const body = { ...f.input.body, overrides: [{ operation: "RESET", elementId: "title", property: "TEXT" }] };
  const requestSha256 = computeHtmlEditingOperationRequestSha256(body);
  assert.equal(beginHtmlEditingJournal(f.storage, { scope: f.input.scope, operationId: uuid, clipId: f.input.clipId,
    createdAt: 1, expected: f.acknowledgment.previous, expectedCompositionDocumentHash: f.base.documentHash, requestSha256 }), true);
  const receipt = { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: f.input.scope, operationId: uuid,
    requestSha256, clipId: f.input.clipId, acknowledgment: { ...f.acknowledgment, changed: false, next: f.acknowledgment.previous } };
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async url => Response.json({ success: true,
    requestId: uuid, correlationId: uuid, data: String(url).includes("/operations/") ? { status: "RECORDED", receipt }
      : String(url).endsWith("/document") ? f.base : f.beforeView }) });
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.equal(host.isBlocked(), false); assert.equal(f.state.payload, f.base); assert.equal(f.state.adoptCount, 0);
});

test("durable dispatch losing POST response can recover after reload using only explicit GETs", async () => {
  const f = setup(), methods: string[] = [];
  const receipt = { scope: "EDITORIAL_OPERATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED", owner: f.input.scope,
    operationId: uuid, requestSha256: computeHtmlEditingOperationRequestSha256(f.input.body), clipId: f.input.clipId, acknowledgment: f.acknowledgment };
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, durableEnabled: () => true, fetcher: async (url, options) => {
    methods.push(options?.method ?? "GET");
    if (options?.method === "POST") { assert.ok(String(url).includes("/operations/")); throw new Error("Lost committed response"); }
    return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: String(url).includes("/operations/")
      ? { status: "RECORDED", receipt } : String(url).endsWith("/document") ? f.candidate : f.afterView });
  } });
  await assert.rejects(host.execute(f.input), /OUTCOME_UNKNOWN/);
  assert.equal(host.isBlocked(), true); f.state.payload = f.candidate;
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.deepEqual(methods, ["POST", "GET", "GET", "GET"]);
  assert.equal(host.isBlocked(), false); assert.equal(f.state.adoptCount, 0);
});

test("explicit recovery after authorized reload closes a persisted ACK with two GETs and no adoption or POST", async () => {
  const f = setup(); pending(f); f.state.payload = f.candidate; f.state.enabled = false;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
    assert.equal(options?.method, "GET"); return f.ports.fetcher(url, options);
  } });
  assert.equal(host.isBlocked(), true);
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.equal(f.state.requests, 2); assert.equal(f.state.adoptCount, 0); assert.equal(f.state.payload, f.candidate);
  assert.equal(host.isBlocked(), false); assert.equal(host.tracking(f.input.scope).status, "EMPTY");
  assert.deepEqual(f.state.busy, [true, false]);
});

test("missing ACK is never inferred from matching saved content and causes no network request", async () => {
  const f = setup(); pending(f, null); f.state.payload = f.candidate;
  const host = new CompositionHtmlEditorialNativeHost(f.ports);
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /ACK_REQUIRED/);
  assert.equal(f.state.requests, 0); assert.equal(host.isBlocked(), true);
  assert.equal(host.tracking({ ...f.input.scope, actorId: other }).status, "UNAVAILABLE");
});

test("stale loaded native document keeps tracking until explicit reload, never overwrites local payload", async () => {
  const f = setup(); pending(f); const host = new CompositionHtmlEditorialNativeHost(f.ports);
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /RELOAD_REQUIRED/);
  assert.equal(f.state.payload, f.base); assert.equal(f.state.adoptCount, 0); assert.equal(host.isBlocked(), true);
  f.state.payload = f.candidate;
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.equal(host.isBlocked(), false); assert.equal(f.state.requests, 4);
});

test("late owner or native identity drift during recovery preserves the exact ACK journal", async () => {
  for (const drift of ["owner", "payload"] as const) {
    const f = setup(); pending(f); f.state.payload = f.candidate;
    const before = [...f.entries.values()][0];
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
      const response = await f.ports.fetcher(url, options);
      if (String(url).endsWith("/document")) {
        if (drift === "owner") f.state.scope = { ...f.input.scope, actorId: other };
        else f.state.payload = { ...f.candidate };
      }
      return response;
    } });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }));
    assert.equal([...f.entries.values()][0], before); assert.equal(f.state.adoptCount, 0); assert.equal(host.isBusy(), false);
  }
});

test("recovery rejects source/hash or inspector locator tampering without closing tracking", async () => {
  for (const drift of ["document", "inspector"] as const) {
    const f = setup(); pending(f); f.state.payload = f.candidate;
    const damaged = structuredClone(f.candidate);
    const clip = damaged.document.clips[0]!;
    if (clip.source.type === "DECK_SLIDE") clip.source.html += "tampered";
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async url => Response.json({ success: true,
      requestId: uuid, correlationId: uuid, data: String(url).endsWith("/document")
        ? drift === "document" ? damaged : f.candidate
        : drift === "inspector" ? { ...f.afterView, revisionSha256: "f".repeat(64) } : f.afterView }) });
    await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /UNVERIFIED/);
    assert.equal(host.isBlocked(), true); assert.equal(f.state.adoptCount, 0);
  }
});

test("replaced tracking during authorized reads cannot be closed by an older recovery", async () => {
  const f = setup(); pending(f); f.state.payload = f.candidate;
  const key = [...f.entries.keys()][0]!;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
    const response = await f.ports.fetcher(url, options);
    if (String(url).endsWith("/document")) {
      const journal = JSON.parse(f.entries.get(key)!);
      f.entries.set(key, JSON.stringify({ ...journal, operationId: other }));
    }
    return response;
  } });
  await assert.rejects(host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal }), /TRACKING_CHANGED/);
  const tracking = readHtmlEditingJournal(f.storage, f.input.scope);
  assert.equal(tracking.status, "PENDING");
  if (tracking.status === "PENDING") assert.equal(tracking.entry.operationId, other);
  assert.equal(f.state.adoptCount, 0);
});

test("abort of a noncooperative recovery read releases native reservation and preserves tracking", async () => {
  const f = setup(); pending(f); f.state.payload = f.candidate;
  const controller = new AbortController(); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
    started(); return await new Promise<Response>(() => {});
  } });
  const recovery = host.recover({ scope: f.input.scope, operationId: uuid, signal: controller.signal });
  await ready; controller.abort(); await assert.rejects(recovery);
  assert.equal(host.isBusy(), false); assert.equal(host.isBlocked(), true); assert.equal(f.state.adoptCount, 0);
  assert.equal(f.queue.snapshot().status, "IDLE");
});

test("acknowledged no-op can close without a native pointer only at its exact original hash", async () => {
  const f = setup(), acknowledgment = { ...f.acknowledgment, changed: false, next: f.acknowledgment.previous };
  pending(f, acknowledgment);
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async url => Response.json({ success: true,
    requestId: uuid, correlationId: uuid, data: String(url).endsWith("/document") ? f.base : f.beforeView }) });
  await host.recover({ scope: f.input.scope, operationId: uuid, signal: f.input.signal });
  assert.equal(host.isBlocked(), false); assert.equal(f.state.payload, f.base); assert.equal(f.state.adoptCount, 0);
});

test("native host runs a single tracked mutation, verified refresh and synchronous adoption under reservation", async () => {
  const f = setup(), host = new CompositionHtmlEditorialNativeHost(f.ports);
  const result = await host.execute(f.input);
  assert.equal(f.state.requests, 3); assert.equal(f.state.adoptCount, 1);
  assert.deepEqual(f.state.payload, f.candidate); assert.equal(result.adoptedDocumentHash, f.candidate.documentHash);
  assert.deepEqual(f.state.busy, [true, false]); assert.equal(host.isBlocked(), false);
  assert.equal(readHtmlEditingJournal(f.storage, f.input.scope).status, "EMPTY");
});

test("disabled writes, owner mismatch, native pending work and malformed expected locator never dispatch", async () => {
  for (const failure of ["disabled", "owner", "pending", "locator"] as const) {
    const f = setup(); if (failure === "disabled") f.state.enabled = false;
    if (failure === "owner") f.state.scope = { ...f.input.scope, actorId: other };
    if (failure === "pending") f.state.conflicting = true;
    const input = failure === "locator" ? { ...f.input, body: { ...f.input.body, expected: { version: 1, sha256: "f".repeat(64) } } } : f.input;
    await assert.rejects(new CompositionHtmlEditorialNativeHost(f.ports).execute(input), /NATIVE_NOT_READY/);
    assert.equal(f.state.requests, 0); assert.equal(f.state.adoptCount, 0);
  }
});

test("lost POST freezes native writes after reload even when new mutations are disabled", async () => {
  const f = setup(); let calls = 0;
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => { calls++; throw new Error("private"); } });
  await assert.rejects(host.execute(f.input), /OUTCOME_UNKNOWN/); assert.equal(calls, 1);
  assert.equal(host.isBusy(), false); assert.equal(host.isBlocked(), true);
  f.state.enabled = false;
  const reloaded = new CompositionHtmlEditorialNativeHost(f.ports); assert.equal(reloaded.isBlocked(), true);
  await assert.rejects(reloaded.execute(f.input), /NATIVE_NOT_READY/); assert.equal(f.state.adoptCount, 0);
});

test("owner/base drift after dispatch cannot adopt a late candidate and preserves the ACK", async () => {
  for (const drift of ["owner", "base"] as const) {
    const f = setup();
    const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => {
      const response = await f.ports.fetcher(url, options);
      if (options?.method === "GET") {
        if (drift === "owner") f.state.scope = { ...f.input.scope, actorId: other };
        else f.state.payload = { ...f.base };
      }
      return response;
    } });
    await assert.rejects(host.execute(f.input), /REFRESH_REQUIRED/);
    assert.equal(f.state.adoptCount, 0); assert.equal(host.isBusy(), false);
    const journal = readHtmlEditingJournal(f.storage, f.input.scope); assert.equal(journal.status, "PENDING");
    if (journal.status === "PENDING") assert.deepEqual(journal.entry.acknowledgment, f.acknowledgment);
  }
});

test("pending or corrupt snapshot tracking blocks HTML dispatch without overwriting it", async () => {
  for (const encoded of ["corrupt", JSON.stringify({ operationId: uuid })]) {
    const f = setup(), key = `courseforge:html-snapshot:v1:${uuid}:${uuid}:${uuid}`;
    f.entries.set(key, encoded);
    await assert.rejects(new CompositionHtmlEditorialNativeHost(f.ports).execute(f.input), /NATIVE_NOT_READY/);
    assert.equal(f.state.requests, 0); assert.equal(f.entries.get(key), encoded);
  }
});

test("no-op does not adopt a new payload or reset unrelated native history", async () => {
  const f = setup(), acknowledgment = { ...f.acknowledgment, changed: false, next: f.acknowledgment.previous };
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async (url, options) => Response.json({ success: true,
    requestId: uuid, correlationId: uuid, data: options?.method === "POST" ? acknowledgment : String(url).endsWith("/document") ? f.base : f.beforeView }) });
  const result = await host.execute(f.input); assert.equal(f.state.adoptCount, 0); assert.equal(f.state.payload, f.base);
  assert.equal(result.adoptedDocumentHash, f.base.documentHash); assert.equal(host.isBlocked(), false);
});

test("abortPending bounds a non-cooperative request and prevents late adoption", async () => {
  const f = setup(); let started!: () => void, rejectLate!: (error: Error) => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  const host = new CompositionHtmlEditorialNativeHost({ ...f.ports, fetcher: async () => {
    started(); return new Promise<Response>((_resolve, reject) => { rejectLate = reject; });
  } });
  const operation = host.execute(f.input); await dispatched;
  assert.equal(host.isBusy(), true); host.abortPending(); await assert.rejects(operation, /OUTCOME_UNKNOWN/);
  assert.equal(host.isBusy(), false); assert.equal(host.isBlocked(), true); assert.equal(f.state.adoptCount, 0);
  rejectLate(new Error("late")); await new Promise<void>(resolve => setImmediate(resolve));
});
