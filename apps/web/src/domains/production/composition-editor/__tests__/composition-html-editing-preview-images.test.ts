import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCompositionHtmlEditingPreviewImage, prepareCompositionHtmlEditingPreviewImages } from "../composition-html-editing-preview-images.server";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";

const origin = "https://storage.example.test";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function resourceFixture() {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer();
  const identity = { productionAssetId: uuid, checksum: hash(bytes), fileSizeBytes: bytes.length, mimeType: "image/png" as const,
    storageBucket: "production-assets", storagePath: "html/image.png" };
  const state = { signedUrl: `${origin}/storage/v1/object/sign/production-assets/html/image.png?token=private`, signs: 0, fetches: 0,
    headerMime: "image/png", status: 200, responseBytes: bytes, contentLength: String(bytes.length), encoding: "identity" };
  const supabase = { storage: { from: () => ({ createSignedUrl: async () => { state.signs++; return { data: { signedUrl: state.signedUrl }, error: null }; } }) } } as unknown as SupabaseClient;
  const fetchResource = (async (_url: unknown, options: RequestInit) => {
    state.fetches++; assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store"); assert.equal(options.credentials, "omit");
    const headers = { "content-type": state.headerMime, "content-length": state.contentLength, "content-encoding": state.encoding };
    return new Response(state.responseBytes, { status: state.status, headers });
  }) as typeof fetch;
  return { bytes, identity, state, input: { identity, supabase, storageOrigin: origin, fetchResource } };
}

test("preview image reader pins actual bytes, size, MIME and static raster dimensions without publishing signed URL", async () => {
  const f = await resourceFixture(), result = await readCompositionHtmlEditingPreviewImage(f.input);
  assert.deepEqual(result, new Uint8Array(f.bytes)); assert.equal(f.state.signs, 1); assert.equal(f.state.fetches, 1);
});

test("preview image reader rejects substituted origins/paths before fetch and preserves safe errors", async () => {
  for (const signedUrl of ["https://evil.test/storage/v1/object/sign/production-assets/html/image.png?token=private",
    `${origin}/storage/v1/object/sign/production-assets/other.png?token=private`,
    `${origin}/storage/v1/object/sign/production-assets/html/image.png?token=one&token=two`,
    `https://secret@storage.example.test/storage/v1/object/sign/production-assets/html/image.png?token=private`]) {
    const f = await resourceFixture(); f.state.signedUrl = signedUrl;
    await assert.rejects(readCompositionHtmlEditingPreviewImage(f.input), /HTML_EDITING_PREVIEW_IMAGES_UNAVAILABLE/);
    assert.equal(f.state.fetches, 0);
  }
});

test("image stream rejects wrong MIME/status/length/hash and formats despite metadata claims", async () => {
  const mutations: Array<(f: Awaited<ReturnType<typeof resourceFixture>>) => void> = [
    f => { f.state.status = 206; }, f => { f.state.headerMime = "image/svg+xml"; },
    f => { f.state.contentLength = "999999"; }, f => { f.state.encoding = "gzip"; },
    f => { f.state.responseBytes = Buffer.alloc(f.bytes.length, 1); },
    f => { f.state.responseBytes = Buffer.concat([f.bytes, Buffer.from("extra")]); },
    f => { f.state.responseBytes = Buffer.from("not an image"); f.identity.fileSizeBytes = f.state.responseBytes.length;
      f.identity.checksum = hash(f.state.responseBytes); f.state.contentLength = String(f.identity.fileSizeBytes); },
  ];
  for (const mutate of mutations) {
    const f = await resourceFixture(); mutate(f);
    await assert.rejects(readCompositionHtmlEditingPreviewImage(f.input), /^HtmlEditingPreviewImageError: HTML_EDITING_PREVIEW_IMAGES_UNAVAILABLE$/);
  }
});

test("pre-aborted image read never signs or fetches", async () => {
  const f = await resourceFixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(readCompositionHtmlEditingPreviewImage({ ...f.input, signal: controller.signal }));
  assert.equal(f.state.signs, 0); assert.equal(f.state.fetches, 0);
});

test("raster admission rejects oversized geometry and animation containers", async () => {
  const oversized = await sharp({ create: { width: 8193, height: 1, channels: 3, background: "#123456" } }).png().toBuffer();
  const f = await resourceFixture();
  const animationChunk = Buffer.alloc(20); animationChunk.writeUInt32BE(8, 0); animationChunk.write("acTL", 4, "ascii");
  animationChunk.writeUInt32BE(2, 8);
  const animated = Buffer.concat([f.bytes.subarray(0, f.bytes.length - 12), animationChunk, f.bytes.subarray(f.bytes.length - 12)]);
  for (const bytes of [oversized, animated]) {
    const sample = await resourceFixture(); sample.state.responseBytes = bytes;
    sample.identity.fileSizeBytes = bytes.length; sample.identity.checksum = hash(bytes); sample.state.contentLength = String(bytes.length);
    await assert.rejects(readCompositionHtmlEditingPreviewImage(sample.input), /HTML_EDITING_PREVIEW_IMAGES_UNAVAILABLE/);
  }
});

test("preview assembler reuses exact reader and image producer, then rejects revocation or identity drift after download", async () => {
  for (const outcome of ["UNCHANGED", "REVOKED", "DRIFT"] as const) {
    const f = await resourceFixture(), template = createHtmlEditingRevisionFixture();
    const native = bindHtmlEditingRevisionToComposition({ ...template.authority, document: template.document,
      revision: template.current.revision, revisionSha256: template.current.sha256 });
    let rpcReads = 0;
    const rpc = () => ({ abortSignal: async () => {
      rpcReads++;
      return { data: { document: native.document, documentHash: native.documentHash,
        revisions: [{ authoritativeBinding: template.authority.authoritativeBinding, revision: template.current.revision,
          grantedAssetIds: outcome === "REVOKED" && rpcReads > 1 ? [] : [uuid, other] }] }, error: null };
    } });
    const from = (table: string) => {
      const query = { select: () => query, eq: () => query, in: () => query, limit: () => query, abortSignal: async () => ({ error: null,
        data: table === "video_composition_draft_assets" ? [{ organization_id: uuid, draft_id: uuid, production_asset_id: uuid }]
          : [{ id: uuid, organization_id: uuid, checksum: outcome === "DRIFT" && rpcReads > 1 ? "f".repeat(64) : f.identity.checksum,
            file_size_bytes: f.identity.fileSizeBytes, mime_type: "image/png", storage_bucket: "production-assets", storage_path: "html/image.png", qa_status: "APPROVED" }] }) };
      return query;
    };
    const supabase = { ...f.input.supabase, rpc, from } as unknown as SupabaseClient;
    const task = prepareCompositionHtmlEditingPreviewImages({ ...f.input, supabase, actorId: uuid, organizationId: uuid,
      documentId: uuid, documentHash: native.documentHash });
    if (outcome === "UNCHANGED") {
      const prepared = await task;
      assert.deepEqual(prepared.images.get(uuid), new Uint8Array(f.bytes)); assert.equal(prepared.document.clips.length, native.document.clips.length);
      assert.equal(prepared.scope, "AUTHORIZED_BYTE_VERIFIED_PREVIEW_IMAGES_NOT_RENDER_EVIDENCE");
    } else await assert.rejects(task, /HTML_EDITING_PREVIEW_IMAGES_UNAVAILABLE/);
    assert.equal(rpcReads, 2); assert.equal(f.state.fetches, 1);
  }
});
