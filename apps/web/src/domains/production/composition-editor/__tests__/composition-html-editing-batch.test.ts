import test from "node:test";
import assert from "node:assert/strict";
import { prepareHtmlEditingBatchCommand, stageHtmlEditingFieldOverride } from "../composition-html-editing-field-command.client";
import { createHtmlEditingMutationService } from "../composition-html-editing-mutation.server";
import { HtmlEditingEditorialHistory } from "../composition-html-editing-history.client";
import { createHtmlEditingInspectorView } from "../html-editing/html-editing-inspector.server";
import { computeHtmlEditableManifestSha256 } from "../html-editing/html-editing-manifest-digest.server";
import { verifyHtmlEditingRevision } from "../html-editing/html-editing-revision.server";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

const replacement = "33333333-3333-4333-8333-333333333333";
function setup() {
  const f = fixture(`<section><h1 id="title">Original</h1><img id="photo" src="conformance-media/${uuid}"><img id="photo2" src="conformance-media/${other}"></section>`);
  const revision = structuredClone(f.current.revision);
  const photo = revision.manifest.elements.find(element => element.kind === "IMAGE");
  if (!photo || photo.kind !== "IMAGE") throw new Error("Missing image fixture");
  photo.allowedAssetIds.push(replacement);
  revision.manifest.elements.push({ kind: "IMAGE", elementId: "photo2", label: "Second photo", allowedAssetIds: [uuid, other, replacement], allowedFits: ["COVER"] });
  revision.manifest.binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(revision.manifest), revision.manifest.binding);
  revision.state.binding = { ...revision.manifest.binding };
  const authority = { ...f.authority, authoritativeBinding: revision.manifest.binding,
    imageSources: new Map([...f.authority.imageSources, [replacement, `conformance-media/${replacement}`]]) };
  const current = verifyHtmlEditingRevision({ ...authority, grantedAssetIds: [uuid, other, replacement], encodedRevision: JSON.stringify(revision) });
  const view = createHtmlEditingInspectorView({ ...authority, grantedAssetIds: [replacement], encodedRevision: JSON.stringify(revision), compositionDocumentHash: f.row.compositionDocumentHash });
  const repairs = ["photo", "photo2"].map(elementId => ({ operation: "SET_IMAGE" as const, elementId, assetId: replacement, fit: "COVER" as const }));
  const state = { writes: 0, encoded: JSON.stringify(revision), grants: [replacement] };
  const mutate = createHtmlEditingMutationService({
    readAuthorized: async () => ({ ...authority, grantedAssetIds: state.grants, encodedRevision: state.encoded, compositionDocumentHash: f.row.compositionDocumentHash }),
    readRestoreRevision: async () => { throw new Error("Unexpected restore"); },
    appendCompareAndSwap: async (request) => {
      state.writes++; state.encoded = JSON.stringify(request.revision);
      return { status: "COMMITTED" as const, version: request.revision.version, sha256: request.sha256 };
    },
  });
  const scope = { actorId: uuid, organizationId: uuid, documentId: uuid, clipId: f.request.scope.clipId };
  return { f, revision, current, view, repairs, state, mutate, scope };
}

test("batch staging replaces a field, orders by manifest and never mutates the view or prior draft", () => {
  const f = setup(), before = JSON.stringify(f.view);
  const first = stageHtmlEditingFieldOverride(f.view, [], f.repairs[1]);
  const second = stageHtmlEditingFieldOverride(f.view, first, f.repairs[0]);
  const third = stageHtmlEditingFieldOverride(f.view, second, { operation: "SET_TEXT", elementId: "title", value: "First" });
  const final = stageHtmlEditingFieldOverride(f.view, third, { operation: "SET_TEXT", elementId: "title", value: "Replacement" });
  assert.deepEqual(final.map(override => override.elementId), ["title", "photo", "photo2"]);
  assert.equal(final.length, 3); assert.equal(first.length, 1); assert.equal(third[0]?.operation, "SET_TEXT");
  assert.notDeepEqual(final[0], third[0]); assert.equal(JSON.stringify(f.view), before);
});

test("incomplete revoked-image repair can be staged but cannot be submitted", () => {
  const f = setup();
  const staged = stageHtmlEditingFieldOverride(f.view, [], f.repairs[0]);
  assert.throws(() => prepareHtmlEditingBatchCommand(f.view, staged), /ASSET_NOT_AUTHORIZED/);
  assert.doesNotThrow(() => prepareHtmlEditingBatchCommand(f.view, stageHtmlEditingFieldOverride(f.view, staged, f.repairs[1])));
  assert.equal(f.state.writes, 0);
});

test("two revoked images are repaired in one server CAS and one forward revision", async () => {
  const f = setup(), body = prepareHtmlEditingBatchCommand(f.view, f.repairs);
  const history = new HtmlEditingEditorialHistory(f.scope);
  history.observe(f.view, uuid); history.beginCommand();
  const result = await f.mutate({ ...body, ...f.scope });
  assert.equal(result.changed, true); assert.equal(result.next.version, 2); assert.equal(f.state.writes, 1);
  assert.deepEqual(result.previous, { version: 1, sha256: f.current.sha256 });
  const saved = JSON.parse(f.state.encoded);
  assert.deepEqual(saved.state.overrides, f.repairs); assert.equal(saved.sourceHtml, f.revision.sourceHtml);
  assert.equal("binding" in body, false); assert.equal("grantedAssetIds" in body, false);
  history.confirm(result);
  history.observe({ ...f.view, revisionVersion: result.next.version, revisionSha256: result.next.sha256,
    state: saved.state }, uuid);
  assert.equal(history.snapshot().undoCount, 1);
  const undo = history.beginRestore("UNDO");
  assert.equal(undo.action, "RESTORE");
  if (undo.action === "RESTORE") assert.deepEqual(undo.restore, result.previous);
});

test("server rejects incomplete repair and invalid second field before any append", async () => {
  const f = setup(), expected = { version: 1, sha256: f.current.sha256 };
  const request = { action: "COMMAND" as const, ...f.scope, expected, expectedCompositionDocumentHash: f.view.compositionDocumentHash };
  await assert.rejects(f.mutate({ ...request, overrides: [f.repairs[0]!] }));
  await assert.rejects(f.mutate({ ...request, overrides: [f.repairs[0]!, { ...f.repairs[1]!, elementId: "missing" }] }));
  assert.equal(f.state.writes, 0); assert.equal(f.state.encoded, JSON.stringify(f.revision));
});

test("fresh grants and native/revision CAS remain mandatory after local staging", async () => {
  const f = setup(), body = prepareHtmlEditingBatchCommand(f.view, f.repairs);
  const fresh = structuredClone(f.view); fresh.grantedAssetIds = [];
  assert.throws(() => prepareHtmlEditingBatchCommand(fresh, f.repairs));
  f.state.grants = [];
  await assert.rejects(f.mutate({ ...body, ...f.scope }));
  f.state.grants = [replacement];
  await assert.rejects(f.mutate({ ...body, ...f.scope, expectedCompositionDocumentHash: "f".repeat(64) }), /REVISION_CONFLICT/);
  assert.equal(f.state.writes, 0);
});

test("empty, duplicate, unknown, oversized and authority-bearing batches fail closed", () => {
  const f = setup();
  for (const overrides of [[], [f.repairs[0], f.repairs[0]], [{ operation: "SET_TEXT", elementId: "missing", value: "Safe" }],
    Array.from({ length: 51 }, () => f.repairs[0]), [{ ...f.repairs[0], actorId: uuid }],
    [{ operation: "SET_TEXT", elementId: "title", value: "x".repeat(65536) }]]) {
    assert.throws(() => prepareHtmlEditingBatchCommand(f.view, overrides));
  }
  assert.equal(f.state.writes, 0);
});
