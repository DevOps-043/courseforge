import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { prepareLegacyHtmlEditingPilot } from "../html-editing/html-editing-legacy-instrumentation.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { prepareHtmlEditingLegacyAdoption } from "../composition-html-editing-legacy-adoption.server";
import { computeHtmlLegacyAdoptionRequestSha256 } from "../composition-html-editing-legacy-adoption-digest.server";
import { coordinateHtmlLegacyAdoption } from "../composition-html-editing-legacy-adoption-coordinator.client";
import { readHtmlLegacyAdoptionJournal } from "../composition-html-editing-legacy-adoption-journal.client";

function fixture() {
  const f = createHtmlEditingRevisionFixture(), binding = f.authority.authoritativeBinding;
  const scope = { actorId: uuid, organizationId: uuid, draftId: uuid };
  const anchor = { organizationId: uuid, documentId: uuid, clipId: binding.clipId, revisionId: other };
  const pilot = prepareLegacyHtmlEditingPilot({ sourceHtml: f.current.revision.sourceHtml,
    authoritativeAnchor: { ...anchor, documentSha256: binding.documentSha256 }, templateId: "legacy_intro", templateVersion: 1,
    grantedAssetIds: f.authority.grantedAssetIds, imageSources: f.authority.imageSources });
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({ format: "courseforge-html-editable-catalog-v1",
    organizationId: uuid, templates: [pilot.candidate.template] }));
  const prepared = prepareHtmlEditingLegacyAdoption({ document: f.document, expectedDocumentHash: binding.documentSha256,
    anchor, templateId: "legacy_intro", templateVersion: 1, encodedPilot: JSON.stringify(pilot),
    expectedProvenanceSha256: pilot.provenanceSha256, catalog, grantedAssetIds: f.authority.grantedAssetIds, imageSources: f.authority.imageSources });
  const request = { candidateId: other, provenanceSha256: pilot.provenanceSha256, expectedDocumentHash: binding.documentSha256 };
  const intent = { organizationId: uuid, documentId: uuid, clipId: binding.clipId, actorId: uuid, operationId: other, request };
  const receipt = { scope: "HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
    owner: scope, clipId: binding.clipId, operationId: other, requestSha256: computeHtmlLegacyAdoptionRequestSha256(intent), request,
    acknowledgment: { status: "CONFIRMED", compositionDocumentHash: prepared.documentHash,
      compositionDocumentVersion: 2, revisionVersion: 1, revisionSha256: prepared.initialRevisionSha256 } };
  const view = createHtmlEditingInspectorView({ authoritativeBinding: prepared.initialRevision.manifest.binding,
    encodedRevision: JSON.stringify(prepared.initialRevision), compositionDocumentHash: prepared.documentHash,
    grantedAssetIds: [uuid], imageSources: f.authority.imageSources });
  const values = new Map<string, string>(), calls: string[] = [];
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const loaded = { document: f.document, documentHash: binding.documentSha256, version: 1 };
  const state = { lost: false, current: true, driftAfterPost: false, failAccept: false, accepted: 0,
    result: { status: "RECORDED", receipt } as unknown,
    payload: { document: prepared.document, documentHash: prepared.documentHash, version: 2 }, view };
  let locked = false, reserved = false;
  const envelope = (data: unknown) => Response.json({ success: true, requestId: uuid, correlationId: uuid, data });
  const input = { scope, action: { mode: "SEND" as const, clipId: binding.clipId, request }, loaded, storage,
    signal: new AbortController().signal, createOperationId: () => other, isCurrent: () => state.current,
    lock: { runExclusive: async <T>(actual: typeof scope, task: () => Promise<T>) => {
      assert.deepEqual(actual, scope); locked = true; try { return await task(); } finally { locked = false; }
    } },
    reserveNative: async <T>(task: () => Promise<T>) => { assert.equal(locked, true); reserved = true;
      try { return await task(); } finally { reserved = false; } },
    acceptVerified: async (_verified: unknown, signal: AbortSignal) => { signal.throwIfAborted(); assert.equal(reserved, true);
      assert.equal(readHtmlLegacyAdoptionJournal(storage, scope).status, "PENDING");
      if (state.failAccept) throw new Error(); state.accepted++;
    },
    fetcher: (async (url, options) => {
      assert.equal(locked && reserved, true);
      if (String(url).includes("/adopt/operations/")) {
        calls.push(options?.method ?? "GET");
        assert.equal(readHtmlLegacyAdoptionJournal(storage, scope).status, "PENDING");
        if (options?.method === "POST") {
          const pending = readHtmlLegacyAdoptionJournal(storage, scope);
          assert.ok(pending.status === "PENDING"); assert.equal(pending.entry.requestSha256, receipt.requestSha256);
          assert.equal([...values.values()].some(value => value.includes("sourceHtml")), false);
          if (state.driftAfterPost) state.current = false;
          if (state.lost) throw new Error("PRIVATE_ACK_LOST");
        }
        return envelope(state.result);
      }
      if (String(url).endsWith("/document")) { calls.push("native"); return envelope(state.payload); }
      calls.push("inspector"); return envelope(state.view);
    }) as typeof fetch,
  };
  return { scope, input, loaded, state, calls, values, storage };
}

test("coordinator journals before its single POST, verifies native/inspector and accepts before closure", async () => {
  const f = fixture(), result = await coordinateHtmlLegacyAdoption(f.input);
  assert.deepEqual(f.calls, ["POST", "native", "inspector"]); assert.equal(f.state.accepted, 1);
  assert.deepEqual(result.payload, f.state.payload); assert.deepEqual(result.view, f.state.view);
  assert.equal(readHtmlLegacyAdoptionJournal(f.storage, f.scope).status, "EMPTY");
});

test("lost adoption ACK survives and RECOVER performs GET only before authorized refresh", async () => {
  const f = fixture(); f.state.lost = true;
  await assert.rejects(coordinateHtmlLegacyAdoption(f.input), /OUTCOME_UNKNOWN/);
  assert.equal(readHtmlLegacyAdoptionJournal(f.storage, f.scope).status, "PENDING");
  f.state.lost = false;
  await coordinateHtmlLegacyAdoption({ ...f.input, action: { mode: "RECOVER", operationId: other } });
  assert.deepEqual(f.calls, ["POST", "GET", "native", "inspector"]); assert.equal(f.state.accepted, 1);
  assert.equal(readHtmlLegacyAdoptionJournal(f.storage, f.scope).status, "EMPTY");
});

test("NOT_FOUND after a stored ACK preserves intent and never retries or accepts current state", async () => {
  const f = fixture(); f.state.failAccept = true;
  await assert.rejects(coordinateHtmlLegacyAdoption(f.input), /REFRESH_REQUIRED/);
  const before = [...f.values.values()][0]; f.state.result = { status: "NOT_FOUND" }; f.state.failAccept = false; f.calls.length = 0;
  await assert.rejects(coordinateHtmlLegacyAdoption({ ...f.input, action: { mode: "RECOVER", operationId: other } }), /ACK_REQUIRED/);
  assert.deepEqual(f.calls, ["GET"]); assert.equal([...f.values.values()][0], before); assert.equal(f.state.accepted, 0);
});

test("owner drift, wrong native version, revoked grants and acceptance failure keep tracking", async () => {
  for (const failure of ["owner", "version", "grants", "accept"] as const) {
    const f = fixture();
    if (failure === "owner") f.state.driftAfterPost = true;
    else if (failure === "version") f.state.payload.version = 3;
    else if (failure === "grants") f.state.view.usedResourcesGranted = false;
    else f.state.failAccept = true;
    await assert.rejects(coordinateHtmlLegacyAdoption(f.input));
    assert.equal(readHtmlLegacyAdoptionJournal(f.storage, f.scope).status, "PENDING"); assert.equal(f.state.accepted, 0);
    assert.equal(f.calls.filter(call => call === "POST").length, 1);
  }
});

test("explicit historical recovery acknowledges server receipt without reactivating HTML or reading inspector", async () => {
  const f = fixture(); f.state.lost = true;
  await assert.rejects(coordinateHtmlLegacyAdoption(f.input), /OUTCOME_UNKNOWN/);
  f.state.payload = f.loaded; f.state.lost = false; f.calls.length = 0;
  const result = await coordinateHtmlLegacyAdoption({ ...f.input, action: { mode: "RECOVER", operationId: other, historicalOnly: true } });
  assert.deepEqual(f.calls, ["GET", "native"]); assert.equal(result.view, null); assert.deepEqual(result.payload, f.loaded);
  assert.equal(readHtmlLegacyAdoptionJournal(f.storage, f.scope).status, "EMPTY");
});

test("pending/corrupt other journals, missing lock and stale base prohibit a new adoption", async () => {
  for (const namespace of ["html-initialization", "html-editorial", "html-snapshot"]) {
    const f = fixture(); f.values.set(`courseforge:${namespace}:v1:${uuid}:${uuid}:${uuid}`, "corrupt");
    await assert.rejects(coordinateHtmlLegacyAdoption(f.input), /NOT_READY/); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); await assert.rejects(coordinateHtmlLegacyAdoption({ ...f.input, lock: null }), /NOT_READY/);
  await assert.rejects(coordinateHtmlLegacyAdoption({ ...f.input, loaded: { ...f.loaded, documentHash: "f".repeat(64) } }), /NOT_READY/);
  assert.deepEqual(f.calls, []);
});
