import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { prepareCompositionHtmlEditingPreviewNativeMedia, HTML_EDITING_PREVIEW_NATIVE_MEDIA_POLICY } from "../composition-html-editing-preview-native-media.server";
import { createTransitionDocument } from "./composition-transition-test-fixtures";

const organizationId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const origin = "https://storage.example.test";
function fixture(bytes = new Uint8Array([1, 2, 3, 4])) {
  const document = createTransitionDocument();
  const secondClip = document.clips[1]!;
  document.clips = [document.clips[0]!];
  const source = document.clips[0]!.source;
  if (source.type !== "PRODUCTION_ASSET") throw new Error();
  const row = { id: source.productionAssetId, organization_id: organizationId,
    checksum: createHash("sha256").update(bytes).digest("hex"), file_size_bytes: bytes.length, mime_type: "video/mp4",
    storage_bucket: "production-assets", storage_path: "native/sample.mp4", qa_status: "APPROVED", public_url: null };
  const rows = [row];
  const state = { linkReads: 0, signs: 0, fetches: 0, change: "" };
  const supabase = {
    from: (table: string) => {
      const query = { select: () => query, eq: (field: string, value: string) => {
        if (field === "organization_id") assert.equal(value, organizationId);
        if (field === "draft_id") assert.equal(value, draftId);
        return query;
      }, in: (_field: string, ids: string[]) => { assert.deepEqual(ids, rows.map(record => record.id).sort()); return query; }, limit: () => query,
      abortSignal: async () => {
        if (table === "video_composition_draft_assets") {
          state.linkReads++;
          return { error: null, data: state.change === "revoked" && state.linkReads > 1 ? []
            : rows.map(record => ({ organization_id: organizationId, draft_id: draftId, production_asset_id: record.id })) };
        }
        assert.equal(table, "production_assets");
        return { error: null, data: rows.map(record => {
          const current = { ...record };
          if (state.linkReads > 1 && state.change === "hash") current.checksum = "f".repeat(64);
          if (state.linkReads > 1 && state.change === "path") current.storage_path = "native/replaced.mp4";
          return current;
        }) };
      } };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: async () => {
      state.signs++;
      return { error: null, data: { signedUrl: `${origin}/storage/v1/object/sign/production-assets/native/sample.mp4?token=private` } };
    } }) },
  } as unknown as SupabaseClient;
  const fetchResource = (async () => {
    state.fetches++;
    return new Response(bytes, { headers: { "content-type": row.mime_type, "content-length": String(bytes.length) } });
  }) as typeof fetch;
  return { bytes, row, rows, secondClip, state, input: { document, organizationId, draftId, supabase, storageOrigin: origin, fetchResource } };
}

test("native preview media reuse draft authorization and expose verified private files with logical compiler aliases", async () => {
  const f = fixture(), prepared = await prepareCompositionHtmlEditingPreviewNativeMedia(f.input);
  const resource = prepared.resources.get(`conformance-media/${f.row.id}`)!;
  try {
    assert.deepEqual(new Uint8Array(await readFile(resource.filePath)), f.bytes);
    assert.equal(prepared.assetUrls.get(f.row.id), `conformance-media/${f.row.id}`);
    assert.equal(prepared.scope, "AUTHORIZED_BYTE_VERIFIED_NATIVE_PREVIEW_MEDIA_NOT_RENDER_EVIDENCE");
    assert.equal(f.state.linkReads, 2); assert.equal(f.state.signs, 1);
  } finally {
    prepared.resources.clear(); // Exposed lookup must not own the cleanup inventory.
    await Promise.all([prepared.dispose(), prepared.dispose()]);
  }
  await assert.rejects(access(resource.filePath), { code: "ENOENT" });
});

test("native preview media reject revoked draft links and changed source hash/path after acquisition", async () => {
  for (const change of ["revoked", "hash", "path"]) {
    const f = fixture(); f.state.change = change;
    await assert.rejects(prepareCompositionHtmlEditingPreviewNativeMedia(f.input), /^HtmlEditingPreviewNativeMediaError: HTML_EDITING_PREVIEW_NATIVE_MEDIA_UNAVAILABLE$/);
    assert.equal(f.state.linkReads, 2); assert.equal(f.state.signs, 1);
  }
});

test("native preparation rejects overbudget bytes and unsupported active image content before signing", async () => {
  for (const mutation of ["budget", "svg"]) {
    const f = fixture();
    if (mutation === "budget") {
      if (f.secondClip.source.type !== "PRODUCTION_ASSET") throw new Error();
      f.row.file_size_bytes = HTML_EDITING_PREVIEW_NATIVE_MEDIA_POLICY.totalBytes / 2 + 1;
      f.rows.push({ ...f.row, id: f.secondClip.source.productionAssetId });
      f.input.document.clips.push(f.secondClip);
    }
    else f.row.mime_type = "image/svg+xml";
    await assert.rejects(prepareCompositionHtmlEditingPreviewNativeMedia(f.input));
    assert.equal(f.state.signs, 0);
  }
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(prepareCompositionHtmlEditingPreviewNativeMedia({ ...f.input, signal: controller.signal }));
  assert.equal(f.state.linkReads, 0);
});

test("native image resources reuse raster admission after private spool and reject non-image bytes", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
  for (const bytes of [new Uint8Array(png), new Uint8Array([1, 2, 3, 4])]) {
    const f = fixture(bytes); f.row.mime_type = "image/png"; f.input.document.clips[0]!.kind = "IMAGE";
    if (bytes.length === png.length) {
      const prepared = await prepareCompositionHtmlEditingPreviewNativeMedia(f.input);
      try { assert.deepEqual(await prepared.resources.get(`conformance-media/${f.row.id}`)!.readSmallBytes(), bytes); }
      finally { await prepared.dispose(); }
      assert.equal(f.state.linkReads, 2);
    } else await assert.rejects(prepareCompositionHtmlEditingPreviewNativeMedia(f.input), /HTML_EDITING_PREVIEW_NATIVE_MEDIA_UNAVAILABLE/);
  }
});
