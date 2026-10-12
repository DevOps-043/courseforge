import assert from "node:assert/strict";
import test from "node:test";
import { generatedDeckIntegrationFixture } from "../../slides/__tests__/generated-deck-integration-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { generatedDeckInitialSource, instantiateGeneratedDeckDocument } from "../composition-generated-deck-import.server";
import { prepareGeneratedDeckInitializations, computeGeneratedDeckInitializationRequestSha256 } from "../composition-generated-deck-initialization.server";
import { hashCompositionDocument } from "../composition-document.service";
import { CompositionHtmlEditorialNativeHost } from "../composition-html-editing-native-host.client";
import { CompositionSaveQueue } from "../composition-save-queue";
import { readGeneratedDeckInitializationJournal, beginGeneratedDeckInitializationJournal } from "../composition-generated-deck-initialization-journal.client";
import { beginHtmlEditingInitializationJournal } from "../composition-html-editing-initialization-journal.client";
import { coordinateGeneratedDeckInitialization, verifyGeneratedDeckInitializationRebase } from "../composition-generated-deck-initialization-coordinator.client";
import type { HtmlEditingNativePayload } from "../composition-html-editing-rebase.client";

async function setup() {
  const fixture = generatedDeckIntegrationFixture(true);
  const generated = (await readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }))!;
  const initial = createInitialCompositionDocument({ animatedDeck: generatedDeckInitialSource(generated), assets: [],
    plan: { title: "Curso", subtitle: "Prueba", accentColor: "#00aabb", durationSeconds: 20 } });
  initial.clips.push({ ...structuredClone(initial.clips[0]), id: "repeat-slide", hfId: "repeat-slide" });
  const document = instantiateGeneratedDeckDocument(initial, generated), documentHash = hashCompositionDocument(document);
  const scope = { actorId: fixture.organizationId, organizationId: fixture.organizationId, draftId: fixture.draftId };
  const prepared = prepareGeneratedDeckInitializations({ owner: scope, document, generated,
    context: { revisionId: fixture.compositionId, documentHash, grantedAssetIds: [fixture.imageId] } });
  const base: HtmlEditingNativePayload = { document, documentHash, version: 1 };
  const candidate = { document: prepared.document, documentHash: prepared.documentHash, version: 2 };
  const receipt = { scope: "GENERATED_DECK_INITIALIZATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const, owner: scope,
    operationId: fixture.compositionId, requestSha256: computeGeneratedDeckInitializationRequestSha256(documentHash), expectedDocumentHash: documentHash,
    documentHash: prepared.documentHash, documentVersion: 2, items: prepared.references.map(reference => ({ ...reference, created: true })) };
  const entries = new Map<string, string>(), storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const queue = new CompositionSaveQueue<number>(async () => true), calls: Array<{ url: string; method: string }> = [];
  const state = { scope, payload: base, serverPayload: base, missingAnchor: false, lostAnchor: false, lostAck: false, notFound: false, enabled: true,
    conflicting: false, corruptedCurrent: false, afterPost: null as (() => void) | null, postWait: null as Promise<void> | null,
    adoptCount: 0, locked: false, busy: [] as boolean[] };
  const signal = new AbortController().signal;
  const host = new CompositionHtmlEditorialNativeHost({ enabled: () => true, initializationEnabled: () => true,
    generatedDeckEnabled: () => state.enabled, getScope: () => state.scope, getPayload: () => state.payload,
    hasConflictingWork: reserved => state.conflicting || (!reserved && queue.snapshot().status !== "IDLE"),
    reserve: task => queue.runExclusiveWhenIdle(task), getStorage: () => storage,
    getLock: () => ({ runExclusive: async (_scope, task) => { state.locked = true; try { return await task(); } finally { state.locked = false; } } }),
    onBusyChange: busy => { state.busy.push(busy); },
    adopt: payload => { state.adoptCount++; state.payload = payload; }, createOperationId: () => fixture.compositionId,
    fetcher: async (url, options) => {
      assert.ok(state.locked); assert.equal(queue.snapshot().status, "RUNNING"); assert.ok(host.isBusy());
      const path = String(url), method = options?.method ?? "GET"; calls.push({ url: path, method });
      let data: unknown;
      if (path.includes("html-editing-initial-anchor")) {
        if (method === "POST") {
          assert.equal(readGeneratedDeckInitializationJournal(storage, scope).status, "EMPTY");
          state.missingAnchor = false;
          if (state.lostAnchor) throw new Error("Unknown initial anchor result");
        }
        data = { documentId: scope.draftId, compositionId: fixture.compositionId, documentHash,
          activeRevisionId: state.missingAnchor ? null : fixture.compositionId };
      } else if (method === "POST") {
        assert.equal(readGeneratedDeckInitializationJournal(storage, scope).status, "PENDING");
        state.serverPayload = candidate; state.afterPost?.();
        if (state.postWait) await state.postWait;
        if (state.lostAck) throw new Error("Lost ACK after successful database commit");
        data = receipt;
      } else if (path.endsWith("/document")) data = state.serverPayload;
      else if (path.includes("/current?")) data = { scope: "GENERATED_DECK_CURRENT_INITIAL_REFERENCES_VERIFIED_NOT_RENDERED", receipt,
        documentHash: receipt.documentHash, documentVersion: state.corruptedCurrent ? 3 : 2, fieldCount: prepared.registrations.reduce((count, row) => count + row.revision.manifest.elements.length, 0) };
      else data = state.notFound ? { status: "NOT_FOUND" } : { status: "RECORDED", receipt };
      return Response.json({ success: true, requestId: fixture.compositionId, correlationId: fixture.compositionId, data });
    },
  });
  const send = () => host.prepareGeneratedDeck({ scope, action: { mode: "SEND" }, signal });
  const recover = (historicalOnly = false) => host.prepareGeneratedDeck({ scope, action: { mode: "RECOVER", operationId: receipt.operationId, historicalOnly }, signal });
  return { fixture, host, state, scope, signal, storage, entries, queue, calls, receipt, prepared, base, candidate, send, recover };
}

test("native host binds the full generated deck with one POST and verified adoption under shared lock/queue", async () => {
  const f = await setup(), current = await f.send();
  assert.equal(current?.receipt.items.length, f.candidate.document.clips.length);
  assert.deepEqual(f.state.payload, f.candidate); assert.equal(f.state.adoptCount, 1);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.host.generatedDeckTracking(f.scope).status, "EMPTY"); assert.equal(f.host.isBlocked(), false);
  assert.deepEqual(f.state.busy, [true, false]); assert.equal(f.queue.snapshot().status, "IDLE");
  assert.deepEqual(f.state.payload.document.clips, f.base.document.clips);
});

test("lost ACK leaves intent durable and blocks bypasses; readonly recovery adopts once without resend", async () => {
  const f = await setup(); f.state.lostAck = true;
  await assert.rejects(f.send(), /OUTCOME_UNKNOWN/);
  assert.equal(f.state.adoptCount, 0); assert.ok(f.host.isBlocked());
  assert.equal(readGeneratedDeckInitializationJournal(f.storage, f.scope).status, "PENDING");
  f.state.enabled = false; assert.ok(f.host.isBlocked());
  await f.recover();
  assert.equal(f.state.adoptCount, 1); assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.host.generatedDeckTracking(f.scope).status, "EMPTY");
});

test("abort releases native queue/lock despite an uncooperative POST; a late ACK cannot adopt or erase intent", async () => {
  const f = await setup(); let release!: () => void, reached!: () => void;
  f.state.postWait = new Promise<void>(resolve => { release = resolve; });
  const sent = new Promise<void>(resolve => { reached = resolve; }); f.state.afterPost = reached;
  const operation = f.send(); await sent; f.host.abortPending();
  await assert.rejects(operation, /OUTCOME_UNKNOWN/);
  assert.equal(f.host.isBusy(), false); assert.equal(f.queue.snapshot().status, "IDLE");
  release(); await new Promise<void>(resolve => setImmediate(resolve));
  const pending = f.host.generatedDeckTracking(f.scope);
  assert.equal(pending.status, "PENDING");
  if (pending.status !== "PENDING") throw new Error();
  assert.equal(pending.entry.receipt, undefined); assert.equal(f.state.adoptCount, 0);
});

test("storage quota or absent draft lock stops before the batch POST", async () => {
  const f = await setup(); f.storage.setItem = () => { throw new Error("Local quota exceeded"); };
  await assert.rejects(f.send(), /NOT_READY/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
  assert.equal(f.state.adoptCount, 0); assert.equal(f.queue.snapshot().status, "IDLE");
  assert.equal(f.host.generatedDeckTracking(f.scope).status, "EMPTY");
  await assert.rejects(coordinateGeneratedDeckInitialization({ scope: f.scope, action: { mode: "SEND" }, loaded: f.base,
    storage: f.storage, lock: null, signal: f.signal, isCurrent: () => true, reserveNative: task => task(),
    acceptVerified: async () => { assert.fail("Missing lock must not adopt"); } }), /NOT_READY/);
});

test("NOT_FOUND is not a retry permission and an exact native hash cannot replace a receipt", async () => {
  const f = await setup(); f.state.lostAck = true; await assert.rejects(f.send());
  f.state.notFound = true; f.state.payload = f.candidate;
  await assert.rejects(f.recover(), /ACK_REQUIRED/);
  await assert.rejects(f.send(), /NOT_READY/);
  assert.equal(f.state.adoptCount, 0); assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.ok(f.host.isBlocked());
});

test("conflicting work or another editorial intent prevents the batch POST", async () => {
  for (const mode of ["conflict", "journal"] as const) {
    const f = await setup(); f.state.conflicting = mode === "conflict";
    if (mode === "journal") beginHtmlEditingInitializationJournal(f.storage, { scope: f.scope, operationId: f.receipt.operationId,
      clipId: f.base.document.clips[0].id, createdAt: 1, request: { expectedDocumentHash: f.base.documentHash, templateId: "owned", templateVersion: 1 } });
    await assert.rejects(f.send(), /NOT_READY/);
    assert.equal(f.calls.filter(call => call.method === "POST").length, 0); assert.equal(f.state.adoptCount, 0);
  }
});

test("explicit full-deck SEND prepares a missing real anchor once before beginning the batch journal", async () => {
  const f = await setup(); f.state.missingAnchor = true;
  await f.send();
  assert.equal(f.state.adoptCount, 1);
  const posts = f.calls.filter(call => call.method === "POST");
  assert.equal(posts.length, 2); assert.match(posts[0].url, /initial-anchor/); assert.match(posts[1].url, /generated-deck-initialization$/);
  assert.equal(f.host.generatedDeckTracking(f.scope).status, "EMPTY");
});

test("uncertain initial anchor stops before batch intent/POST and is never retried within the attempt", async () => {
  const f = await setup(); f.state.missingAnchor = true; f.state.lostAnchor = true;
  await assert.rejects(f.send(), /NOT_READY/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.ok(!f.calls.some(call => call.url.endsWith("generated-deck-initialization")));
  assert.equal(f.state.adoptCount, 0); assert.equal(f.host.generatedDeckTracking(f.scope).status, "EMPTY");
});

test("current-state drift or owner switch after POST cannot adopt or silently close confirmed tracking", async () => {
  for (const mode of ["current", "owner"] as const) {
    const f = await setup(); f.state.corruptedCurrent = mode === "current";
    if (mode === "owner") f.state.afterPost = () => { f.state.scope = { ...f.scope, actorId: f.fixture.imageId }; };
    await assert.rejects(f.send());
    assert.equal(f.state.adoptCount, 0); assert.equal(readGeneratedDeckInitializationJournal(f.storage, f.scope).status, "PENDING");
    assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  }
});

test("historical confirmation after a later edit never restores the original batch document", async () => {
  const f = await setup(); f.state.lostAck = true; await assert.rejects(f.send());
  const newer = structuredClone(f.candidate); newer.document.clips[0].layout.x += 10;
  newer.documentHash = hashCompositionDocument(newer.document); newer.version = 3;
  f.state.payload = newer; f.state.serverPayload = newer;
  await assert.rejects(f.recover(), /UNVERIFIED|REFRESH_REQUIRED/);
  assert.equal(await f.recover(true), null);
  assert.equal(f.state.adoptCount, 0); assert.deepEqual(f.state.payload, newer);
  assert.equal(f.host.generatedDeckTracking(f.scope).status, "EMPTY");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("reloaded acknowledged payload can be verified; forged layout or missing initial reference cannot", async () => {
  const f = await setup();
  assert.deepEqual(await verifyGeneratedDeckInitializationRebase({ loaded: f.candidate, candidate: f.candidate, receipt: f.receipt, signal: f.signal }), f.candidate);
  for (const change of ["layout", "reference"] as const) {
    const forged = structuredClone(f.candidate);
    if (change === "layout") forged.document.clips[0].layout.x++;
    else forged.document.htmlEditing!.items.pop();
    forged.documentHash = hashCompositionDocument(forged.document);
    await assert.rejects(verifyGeneratedDeckInitializationRebase({ loaded: f.base, candidate: forged, receipt: { ...f.receipt, documentHash: forged.documentHash }, signal: f.signal }), /UNVERIFIED/);
  }
});

test("pending generated journal blocks anchor, individual initialization, editorial recovery and corrupted tracking", async () => {
  const f = await setup(); beginGeneratedDeckInitializationJournal(f.storage, { scope: f.scope,
    request: { operationId: f.receipt.operationId, requestSha256: f.receipt.requestSha256, expectedDocumentHash: f.base.documentHash }, createdAt: 1 });
  assert.ok(f.host.isBlocked());
  await assert.rejects(f.host.initialAnchor({ scope: f.scope, action: "CONSULT", signal: f.signal }), /NOT_READY/);
  await assert.rejects(f.host.initialize({ scope: f.scope, action: { mode: "SEND", clipId: f.base.document.clips[0].id,
    body: { expectedDocumentHash: f.base.documentHash, templateId: "owned", templateVersion: 1 } }, signal: f.signal }), /NOT_READY/);
  await assert.rejects(f.host.recover({ scope: f.scope, operationId: f.receipt.operationId, signal: f.signal }), /NOT_READY/);
  assert.equal(f.calls.length, 0);
  f.entries.set([...f.entries.keys()][0], "{");
  assert.equal(f.host.generatedDeckTracking(f.scope).status, "UNAVAILABLE"); assert.ok(f.host.isBlocked());
});
