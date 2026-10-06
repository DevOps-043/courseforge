import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlEditingReferenceFixture } from "./composition-html-editing-reference-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { prepareCompositionHtmlEditingSnapshotImages } from "../composition-html-editing-snapshot-images.service";

function fixture() {
  const reference = createHtmlEditingReferenceFixture();
  const row = {document: reference.native.document, documentHash: reference.native.documentHash,
    revisions: [{revision: reference.input.next.revision, authoritativeBinding: reference.input.authority.authoritativeBinding,
      grantedAssetIds: [uuid, other]}]};
  const state = { links: [{organization_id: uuid, draft_id: uuid, production_asset_id: uuid}] as unknown,
    assets: [{id: uuid, organization_id: uuid, checksum: "a".repeat(64), file_size_bytes: 1024,
      mime_type: "image/png", storage_bucket: "production-assets", storage_path: "html/image.png", qa_status: "APPROVED"}] as unknown,
    failTable: "", rpcError: null as unknown, onRead: undefined as (() => void) | undefined };
  const calls: Array<{table: string; method: string; args: unknown[]}> = [];
  const supabase = {rpc: () => ({abortSignal: async () => {
    calls.push({table: "rpc", method: "read", args: []}); return {data: row, error: state.rpcError};
  }}), from: (table: string) => {
    const query = {select: (...args: unknown[]) => {calls.push({table, method: "select", args}); return query;},
      eq: (...args: unknown[]) => {calls.push({table, method: "eq", args}); return query;},
      in: (...args: unknown[]) => {calls.push({table, method: "in", args}); return query;},
      limit: (...args: unknown[]) => {calls.push({table, method: "limit", args}); return query;},
      abortSignal: async (signal: AbortSignal) => {
        state.onRead?.(); signal.throwIfAborted();
        return {data: table === "production_assets" ? state.assets : state.links,
          error: state.failTable === table ? {message: "PRIVATE_DETAIL"} : null};
      }}; return query;
  }};
  return {reference, state, calls, input: {actorId: uuid, organizationId: uuid, documentId: uuid,
    documentHash: reference.native.documentHash, supabase: supabase as never}};
}

test("producer resolves only used HTML images in bounded scoped batches after exact authorized read", async () => {
  const f = fixture();
  const result = await prepareCompositionHtmlEditingSnapshotImages(f.input);
  assert.equal(result.imageAssets.length, 1);
  assert.equal(result.imageAssets[0]!.productionAssetId, uuid);
  assert.equal(result.bundle.sha256, f.reference.bundle.sha256);
  assert.equal(f.calls[0]!.table, "rpc");
  assert.deepEqual(f.calls.filter(call => call.method === "in").map(call => call.args[1]), [[uuid], [uuid]]);
  assert.ok(f.calls.some(call => call.method === "eq" && call.args[0] === "draft_id" && call.args[1] === uuid));
  assert.deepEqual(f.calls.filter(call => call.method === "limit").map(call => call.args), [[2], [2]]);
  assert.doesNotMatch(JSON.stringify(result.imageAssets), /signedUrl|token|public_url/);
});

test("historical authorization failure prevents asset acquisition", async () => {
  const f = fixture(); f.state.rpcError = {message: "DENIED"};
  await assert.rejects(prepareCompositionHtmlEditingSnapshotImages(f.input), /READ_UNAVAILABLE/);
  assert.equal(f.calls.length, 1);
});

test("missing, foreign and duplicate draft links reject before image records are requested", async () => {
  for (const links of [[], [{organization_id: other, draft_id: uuid, production_asset_id: uuid}],
    [{organization_id: uuid, draft_id: other, production_asset_id: uuid}],
    [{organization_id: uuid, draft_id: uuid, production_asset_id: other}],
    [{organization_id: uuid, draft_id: uuid, production_asset_id: uuid},
      {organization_id: uuid, draft_id: uuid, production_asset_id: uuid}]]) {
    const f = fixture(); f.state.links = links;
    await assert.rejects(prepareCompositionHtmlEditingSnapshotImages(f.input), /IMAGE_SCOPE_MISMATCH|IMAGES_UNAVAILABLE/);
    assert.ok(!f.calls.some(call => call.table === "production_assets"));
  }
});

test("foreign/missing/duplicate records, revoked status and unsafe image identity fail closed", async () => {
  const base = (fixture().state.assets as Array<Record<string, unknown>>)[0]!;
  for (const assets of [[], [base, base], [{...base, organization_id: other}], [{...base, id: other}],
    [{...base, qa_status: "REJECTED"}], [{...base, mime_type: "image/svg+xml"}],
    [{...base, checksum: "invalid"}], [{...base, file_size_bytes: 32 * 1024 * 1024 + 1}],
    [{...base, storage_path: "../escape"}], [{...base, storage_bucket: "private-secrets"}]]) {
    const f = fixture(); f.state.assets = assets;
    await assert.rejects(prepareCompositionHtmlEditingSnapshotImages(f.input), /IMAGE_IDENTITY_INVALID/);
  }
});

test("storage lookup errors do not leak provider details or retry acquisition", async () => {
  for (const table of ["video_composition_draft_assets", "production_assets"]) {
    const f = fixture(); f.state.failTable = table;
    await assert.rejects(prepareCompositionHtmlEditingSnapshotImages(f.input), error => error instanceof Error
      && error.message === "HTML_EDITING_SNAPSHOT_IMAGES_UNAVAILABLE");
    assert.equal(f.calls.filter(call => call.table === table && call.method === "select").length, 1);
  }
});

test("cancellation during acquisition prevents publishing a prepared asset manifest", async () => {
  const f = fixture(), cancellation = new AbortController();
  const reason = new Error("CANCELLED_ACQUISITION");
  f.state.onRead = () => cancellation.abort(reason);
  await assert.rejects(prepareCompositionHtmlEditingSnapshotImages({...f.input, signal: cancellation.signal}), error => error === reason);
  assert.ok(!f.calls.some(call => call.table === "production_assets"));
});
