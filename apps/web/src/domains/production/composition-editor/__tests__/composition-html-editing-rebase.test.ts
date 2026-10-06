import test from "node:test";
import assert from "node:assert/strict";
import { verifyHtmlEditingRebase, readHtmlEditingRebaseCandidate } from "../composition-html-editing-rebase.client";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { hashCompositionDocument } from "../composition-document-hash";
import { hashCompositionDocumentInBrowser } from "../composition-recovery-journal";
import { dispatchTrackedHtmlEditingMutation } from "../composition-html-editing-dispatch.client";
import { readHtmlEditingJournal } from "../composition-html-editing-journal.client";
import { CompositionSaveQueue } from "../composition-save-queue";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function setup(alreadyBound = false) {
  const f = fixture();
  const bound = bindHtmlEditingRevisionToComposition({ ...f.authority, document: f.document,
    revision: f.current.revision, revisionSha256: f.current.sha256 });
  const base = { document: alreadyBound ? bound.document : f.document, documentHash: alreadyBound ? bound.documentHash : f.row.compositionDocumentHash, version: 4 };
  const saved = bindHtmlEditingRevisionToComposition({ ...f.authority, document: base.document,
    revision: f.next.revision, revisionSha256: f.next.sha256 });
  const candidate = { ...saved, version: 5 };
  const beforeView = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(f.current.revision), compositionDocumentHash: base.documentHash });
  const afterView = createHtmlEditingInspectorView({ ...f.authority, encodedRevision: JSON.stringify(f.next.revision), compositionDocumentHash: candidate.documentHash });
  const acknowledgment = { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED" as const, changed: true,
    previous: { version: 1, sha256: f.current.sha256 }, next: { version: 2, sha256: f.next.sha256 } };
  const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
  const input = { scope, clipId: f.request.scope.clipId, base, candidate, beforeView, afterView, acknowledgment, signal: new AbortController().signal };
  return { f, input };
}

test("rebase verifies the first pointer and an existing pointer without changing source or timing", async () => {
  for (const bound of [false, true]) {
    const { input } = setup(bound); const result = await verifyHtmlEditingRebase(input);
    assert.deepEqual(result, input.candidate);
    assert.deepEqual(result.document.clips, input.base.document.clips);
    assert.deepEqual(result.document.canvas, input.base.document.canvas);
    assert.equal(await hashCompositionDocumentInBrowser(result.document), hashCompositionDocument(result.document));
  }
});

test("no-op confirms an unchanged native document, including an unbound initial revision", async () => {
  const { input } = setup();
  assert.deepEqual(await verifyHtmlEditingRebase({ ...input, candidate: input.base, afterView: input.beforeView,
    acknowledgment: { ...input.acknowledgment, changed: false, next: input.acknowledgment.previous } }), input.base);
});

test("a self-consistent candidate hash cannot conceal unrelated native edits", async () => {
  const { input } = setup(); const document = structuredClone(input.candidate.document);
  document.clips[0]!.label = "Concurrent edit";
  const documentHash = hashCompositionDocument(document);
  await assert.rejects(verifyHtmlEditingRebase({ ...input, candidate: { ...input.candidate, document, documentHash },
    afterView: { ...input.afterView, compositionDocumentHash: documentHash } }), /REBASE_UNVERIFIED/);
});

test("foreign scope, version drift, wrong ACK/inspector hashes and changed source fail closed", async () => {
  const { input } = setup(); const altered = structuredClone(input.base.document);
  const clip = altered.clips[0]!; if (clip.source.type === "DECK_SLIDE") clip.source.html += "changed";
  const alteredHash = hashCompositionDocument(altered);
  const cases = [
    { scope: { ...input.scope, organizationId: other } },
    { candidate: { ...input.candidate, version: 6 } },
    { afterView: { ...input.afterView, revisionSha256: "f".repeat(64) } },
    { candidate: { ...input.candidate, documentHash: "f".repeat(64) } },
    { acknowledgment: { ...input.acknowledgment, previous: { version: 1, sha256: "f".repeat(64) } } },
    { base: { ...input.base, document: altered, documentHash: alteredHash }, beforeView: { ...input.beforeView, compositionDocumentHash: alteredHash } },
  ];
  for (const changes of cases) await assert.rejects(verifyHtmlEditingRebase({ ...input, ...changes }), /REBASE_UNVERIFIED/);
});

test("a mismatched previous pointer or manifest cannot be adopted", async () => {
  const { input } = setup(true); const document = structuredClone(input.base.document);
  document.htmlEditing!.items[0]!.revisionSha256 = "f".repeat(64);
  const documentHash = hashCompositionDocument(document);
  await assert.rejects(verifyHtmlEditingRebase({ ...input, base: { ...input.base, document, documentHash },
    beforeView: { ...input.beforeView, compositionDocumentHash: documentHash } }), /REBASE_UNVERIFIED/);
  const manifest = structuredClone(input.afterView.manifest); manifest.elements[0]!.label = "Different manifest";
  await assert.rejects(verifyHtmlEditingRebase({ ...input, afterView: { ...input.afterView, manifest } }), /REBASE_UNVERIFIED/);
});

test("rebase reader makes only two bounded authorized GETs and returns a verified detached candidate", async () => {
  const { input } = setup(); const urls: string[] = [];
  const result = await readHtmlEditingRebaseCandidate({ ...input, fetcher: async (url, options) => {
    urls.push(String(url)); assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin");
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store"); assert.equal(options?.body, undefined);
    return Response.json({ success: true, requestId: uuid, correlationId: uuid, data: urls.length === 1 ? input.candidate : input.afterView });
  } });
  assert.deepEqual(urls, [`/api/production/hyperframes/drafts/${uuid}/document`, `/api/production/hyperframes/drafts/${uuid}/html-editing/${input.clipId}`]);
  assert.deepEqual(result.payload, input.candidate); assert.deepEqual(result.view, input.afterView);
  assert.notEqual(result.payload.document, input.candidate.document);
});

test("read cancellation makes no request; bad correlation stops after one GET without retry", async () => {
  const { input } = setup(); const controller = new AbortController(); controller.abort(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ success: true, requestId: uuid, correlationId: other, data: input.candidate }); };
  await assert.rejects(readHtmlEditingRebaseCandidate({ ...input, signal: controller.signal, fetcher }), /REBASE_UNVERIFIED/); assert.equal(calls, 0);
  await assert.rejects(readHtmlEditingRebaseCandidate({ ...input, fetcher }), /REBASE_UNVERIFIED/); assert.equal(calls, 1);
});

test("a newer inspector between reads is a conflict, never an automatic merge", async () => {
  const { input } = setup(); let calls = 0;
  await assert.rejects(readHtmlEditingRebaseCandidate({ ...input, fetcher: async () => {
    calls++; return Response.json({ success: true, requestId: uuid, correlationId: uuid,
      data: calls === 1 ? input.candidate : { ...input.afterView, compositionDocumentHash: "f".repeat(64) } });
  } }), /REBASE_UNVERIFIED/);
  assert.equal(calls, 2);
});

test("tracked dispatch uses the verified refresh before adopting and closing its journal", async () => {
  const { input } = setup(), entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const queue = new CompositionSaveQueue<number>(async () => true);
  const calls: string[] = []; let adopted = input.base;
  const fetcher: typeof fetch = async (_url, options) => {
    calls.push(String(options?.method)); assert.equal(queue.snapshot().status, "RUNNING");
    assert.equal(readHtmlEditingJournal(storage, input.scope).status, "PENDING");
    return Response.json({ success: true, requestId: uuid, correlationId: uuid,
      data: calls.length === 1 ? input.acknowledgment : calls.length === 2 ? input.candidate : input.afterView });
  };
  await dispatchTrackedHtmlEditingMutation({ scope: input.scope, clipId: input.clipId, storage,
    lock: { runExclusive: async <T>(_scope: typeof input.scope, task: () => Promise<T>) => task() },
    reserveNative: <T>(task: () => Promise<T>) => queue.runExclusiveWhenIdle(task), isCurrentAndEditable: () => true,
    createOperationId: () => uuid, fetcher,
    body: { action: "COMMAND", expected: input.acknowledgment.previous, expectedCompositionDocumentHash: input.base.documentHash,
      overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }] },
    rebase: async (acknowledgment, signal) => {
      const result = await readHtmlEditingRebaseCandidate({ ...input, acknowledgment, signal, fetcher });
      signal.throwIfAborted(); assert.equal(adopted, input.base);
      adopted = result.payload; return true;
    } });
  assert.deepEqual(calls, ["POST", "GET", "GET"]);
  assert.deepEqual(adopted, input.candidate); assert.equal(readHtmlEditingJournal(storage, input.scope).status, "EMPTY");
  assert.equal(queue.snapshot().status, "IDLE");
});
