import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { compositionNativeTextSourceSchema } from "../composition-text-layer.types";
import { loadNarrativeFragmentPlan, queryNarrativeFragment, type NarrativeFragmentReadRepository } from "../composition-narrative-fragment-query.server";
import { narrativeFragmentSummarySchema } from "../composition-narrative-fragment-contract";

const organizationId = "33333333-3333-4333-8333-333333333333";
const componentId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const fontId = "77777777-7777-4777-8777-777777777777";
function fixture(withFont = false) {
  const document = createNarrativeDocumentFixture(); document.format = "courseforge-composition-v3";
  document.tracks.push({ id: "text", kind: "OVERLAY", semanticRole: "TEXT", label: "Texto", order: 1, locked: false });
  document.clips.push({ ...document.clips[0]!, id: "title", hfId: "hf-title", sceneId: undefined, kind: "TEXT", trackId: "text",
    sourceOffsetSeconds: undefined, sourceDurationSeconds: undefined,
    source: compositionNativeTextSourceSchema.parse({ type: "NATIVE_TEXT", text: "Texto manual", style: withFont ? { fontAssetId: fontId, fontFamily: "Curso" } : {} }) });
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  const documentHash = "b".repeat(64);
  const asset = { id: occurrence.assetId, organization_id: organizationId, material_component_id: componentId,
    asset_type: "VOICE_AUDIO", mime_type: "audio/mpeg", checksum: "c".repeat(64), qa_status: "APPROVED", duration_milliseconds: 10_000,
    metadata: { script_hash: occurrence.scriptHash, word_timestamps: document.narrativeScenes![0]!.wordTimestamps } };
  const font = { id: fontId, organization_id: organizationId, source: "uploaded", status: "READY", family: "Curso",
    checksum_sha256: "d".repeat(64), file_size_bytes: 1000, mime_type: "font/woff2" };
  const calls: { name: string; scope?: unknown; ids?: readonly string[] }[] = [];
  const repository: NarrativeFragmentReadRepository = {
    readComponentId: async (draft, org) => { calls.push({ name: "component", scope: [draft, org] }); return componentId; },
    readDocument: async (draft, org) => { calls.push({ name: "document", scope: [draft, org] }); return { document, documentHash }; },
    readAssets: async (scope, ids, anchor) => { calls.push({ name: "assets", scope: { ...scope, anchor }, ids }); return [asset]; },
    readFonts: async (org, ids) => { calls.push({ name: "fonts", scope: org, ids }); return [font]; },
  };
  return { document, asset, font, calls, repository, parameters: { draftId, organizationId, commandId, repository,
    signal: new AbortController().signal, request: { contract: "NARRATIVE_FRAGMENT_QUERY_V1" as const,
      selectedTrackIds: ["voice", "text"], selection: { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 2 } } } };
}
test("reconstructs from server scope and exposes only bounded public summary without operations or source identifiers", async () => {
  const { parameters, calls, asset } = fixture();
  const result = await queryNarrativeFragment(parameters); assert.ok(result.ok);
  assert.ok(narrativeFragmentSummarySchema.safeParse(result.summary).success);
  assert.equal(result.summary.clipCount, 2); assert.equal(result.summary.trackCount, 2);
  assert.ok(!JSON.stringify(result.summary).includes(asset.id)); assert.ok(!JSON.stringify(result.summary).includes("operations"));
  assert.deepEqual(calls.find(call => call.name === "assets"), { name: "assets", scope: { draftId, organizationId, componentId, anchor: asset.id }, ids: [asset.id] });
  assert.equal(calls.some(call => call.name === "fonts"), false);
});
test("stale revision, unknown tracks and missing draft reject before registry reads", async () => {
  const stale = fixture(); stale.parameters.request.selection.documentHash = "e".repeat(64);
  assert.deepEqual(await loadNarrativeFragmentPlan(stale.parameters), { ok: false, reason: "STALE_DOCUMENT" });
  assert.equal(stale.calls.some(call => call.name === "assets"), false);
  const unknown = fixture(); unknown.parameters.request.selectedTrackIds = ["voice", "unknown"];
  assert.deepEqual(await loadNarrativeFragmentPlan(unknown.parameters), { ok: false, reason: "INVALID_TRACK_SELECTION" });
  assert.equal(unknown.calls.some(call => call.name === "assets"), false);
  const missing = fixture(); missing.repository.readComponentId = async () => null;
  assert.deepEqual(await loadNarrativeFragmentPlan(missing.parameters), { ok: false, reason: "DRAFT_NOT_FOUND" });
  assert.equal(missing.calls.length, 0);
});
test("incomplete, duplicate, foreign and malformed asset batches cannot authorize a plan", async () => {
  for (const batch of [[], [{ id: draftId }], [{ id: "invalid" }]]) {
    const current = fixture(); current.repository.readAssets = async () => batch;
    assert.deepEqual(await loadNarrativeFragmentPlan(current.parameters), { ok: false, reason: "ASSET_BINDING_UNAVAILABLE" });
  }
  const foreign = fixture(); foreign.asset.organization_id = draftId;
  assert.deepEqual(await loadNarrativeFragmentPlan(foreign.parameters), { ok: false, reason: "ASSET_SCOPE_MISMATCH" });
});
test("READY font metadata binds family, hash, MIME and size into the reviewed fingerprint", async () => {
  const current = fixture(true); const plan = await loadNarrativeFragmentPlan(current.parameters); assert.ok(plan.ok);
  assert.deepEqual(plan.plan.fontBindings, [{ fontAssetId: fontId, family: "Curso", checksumSha256: "d".repeat(64), fileSizeBytes: 1000, mimeType: "font/woff2" }]);
  const first = await queryNarrativeFragment(current.parameters); assert.ok(first.ok);
  current.font.checksum_sha256 = "e".repeat(64);
  const second = await queryNarrativeFragment(current.parameters); assert.ok(second.ok);
  assert.notEqual(first.summary.reviewFingerprint, second.summary.reviewFingerprint);
});
test("font revocation, wrong tenant/family, absent record and duplicate records reject safely", async () => {
  for (const patch of [{ status: "REJECTED" }, { organization_id: draftId }, { family: "Otra" }, { checksum_sha256: "bad" }, { mime_type: "text/plain" }]) {
    const current = fixture(true); current.repository.readFonts = async () => [{ ...current.font, ...patch }];
    assert.deepEqual(await loadNarrativeFragmentPlan(current.parameters), { ok: false, reason: "FONT_BINDING_UNAVAILABLE" });
  }
  for (const duplicate of [false, true]) {
    const current = fixture(true); current.repository.readFonts = async () => duplicate ? [current.font, current.font] : [];
    assert.deepEqual(await loadNarrativeFragmentPlan(current.parameters), { ok: false, reason: "FONT_BINDING_UNAVAILABLE" });
  }
});
test("aborted and failed reads do not become an eligible plan", async () => {
  const aborted = fixture(); const controller = new AbortController(); controller.abort(); aborted.parameters.signal = controller.signal;
  await assert.rejects(loadNarrativeFragmentPlan(aborted.parameters)); assert.equal(aborted.calls.length, 0);
  const late = fixture(); const lateController = new AbortController(); late.parameters.signal = lateController.signal;
  late.repository.readAssets = async () => { lateController.abort(); return [late.asset]; };
  await assert.rejects(loadNarrativeFragmentPlan(late.parameters));
  const failed = fixture(); failed.repository.readAssets = async () => { throw Error("backend failure"); };
  await assert.rejects(loadNarrativeFragmentPlan(failed.parameters), /backend failure/);
});
test("client-supplied assets, operations and tenant fields are rejected before reads", async () => {
  for (const patch of [{ assets: [] }, { operations: [] }, { organizationId }]) {
    const current = fixture();
    await assert.rejects(loadNarrativeFragmentPlan({ ...current.parameters, request: { ...current.parameters.request, ...patch } }));
    assert.equal(current.calls.length, 0);
  }
});
