import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareCompositionHtmlEditingPreviewFonts } from "../composition-html-editing-preview-fonts.server";
import { HTML_EDITING_PREVIEW_STORAGE_POLICY, readHtmlEditingPreviewStorageBytes } from "../composition-html-editing-preview-storage.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";

const id = "70000000-0000-4000-8000-000000000001";
const origin = "https://storage.example.test";
function fixture() {
  // Synthetic bytes prove only acquisition/integrity; they are not a valid font.
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const row = { id, family: "Pinned Font", source: "uploaded", status: "READY",
    checksum_sha256: createHash("sha256").update(bytes).digest("hex"), mime_type: "font/woff2",
    file_size_bytes: bytes.length, storage_bucket: "organization-fonts", storage_path: "fonts/pinned.woff2" };
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: { accentColor: "#38BDF8", durationSeconds: 8, title: "Fonts", subtitle: "Pinned" } });
  const { clip, track } = createCompositionNativeOverlay({ document, id: "native", kind: "TEXT", playheadSeconds: 0 });
  if (clip.source.type !== "NATIVE_TEXT") throw new Error();
  clip.source.style.fontAssetId = id; clip.source.style.fontFamily = row.family;
  if (track) document.tracks.push(track);
  document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const state = { reads: 0, signs: 0, fetches: 0, changed: "" };
  const supabase = {
    from: (table: string) => {
      assert.equal(table, "organization_slide_fonts");
      const query = { select: () => query, eq: (field: string, value: string) => {
        assert.equal(field, "organization_id"); assert.equal(value, id); return query;
      }, in: (_field: string, ids: string[]) => {
        assert.deepEqual(ids, [id]); state.reads++;
        const current = { ...row };
        if (state.reads > 1) {
          if (state.changed === "hash") current.checksum_sha256 = "f".repeat(64);
          if (state.changed === "path") current.storage_path = "fonts/replaced.woff2";
          if (state.changed === "revoked") current.status = "REJECTED";
        }
        return Promise.resolve({ data: [current], error: null });
      } };
      return query;
    },
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string) => {
      state.signs++;
      return { data: { signedUrl: `${origin}/storage/v1/object/sign/${bucket}/${path}?token=private` }, error: null };
    } }) },
  } as unknown as SupabaseClient;
  const fetchResource = (async () => {
    state.fetches++;
    return new Response(bytes, { headers: { "content-type": row.mime_type, "content-length": String(bytes.length) } });
  }) as typeof fetch;
  return { bytes, row, document, state, input: { document, organizationId: id, supabase, storageOrigin: origin, fetchResource } };
}

test("native preview fonts reuse tenant reader, verify bytes and expose only local compiler aliases", async () => {
  const f = fixture(), prepared = await prepareCompositionHtmlEditingPreviewFonts(f.input);
  const path = `assets/fonts/${f.row.checksum_sha256}.woff2`;
  assert.deepEqual(prepared.resources.get(path)?.bytes, f.bytes);
  assert.deepEqual(prepared.fonts.get(id), { assetId: id, family: "Pinned Font", format: "woff2", sourceUrl: path });
  assert.equal(prepared.scope, "AUTHORIZED_NATIVE_FONT_BYTES_NOT_GLYPH_OR_RENDER_EVIDENCE");
  assert.deepEqual(f.state, { reads: 2, signs: 1, fetches: 1, changed: "" });
});

test("font preparation rejects revocation, checksum and storage path drift after acquisition", async () => {
  for (const changed of ["hash", "path", "revoked"]) {
    const f = fixture(); f.state.changed = changed;
    await assert.rejects(prepareCompositionHtmlEditingPreviewFonts(f.input), /^HtmlEditingPreviewFontError: HTML_EDITING_PREVIEW_FONTS_UNAVAILABLE$/);
    assert.equal(f.state.reads, 2); assert.equal(f.state.fetches, 1);
  }
});

test("font admission rejects wrong bucket, MIME, family, size and abort before signing", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.row.storage_bucket = "production-assets"; },
    (f: ReturnType<typeof fixture>) => { f.row.mime_type = "image/png"; },
    (f: ReturnType<typeof fixture>) => { f.row.family = "Other Font"; },
    (f: ReturnType<typeof fixture>) => { f.row.file_size_bytes = 51 * 1024 * 1024; },
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(prepareCompositionHtmlEditingPreviewFonts(f.input)); assert.equal(f.state.signs, 0);
  }
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(prepareCompositionHtmlEditingPreviewFonts({ ...f.input, signal: controller.signal }));
  assert.equal(f.state.reads, 0);
});

test("shared Storage transport bounds buffering before signing and rejects unauthorized bucket/path metadata", async () => {
  for (const change of [
    { fileSizeBytes: HTML_EDITING_PREVIEW_STORAGE_POLICY.bufferedBytes + 1 },
    { storageBucket: "private-secrets" }, { storagePath: "../escape" },
  ]) {
    const f = fixture();
    await assert.rejects(readHtmlEditingPreviewStorageBytes({ ...f.input, identity: {
      checksum: f.row.checksum_sha256, fileSizeBytes: f.bytes.length, mimeType: "font/woff2",
      storageBucket: "organization-fonts", storagePath: "fonts/pinned.woff2", ...change,
    } }), /HTML_EDITING_PREVIEW_STORAGE_UNAVAILABLE/);
    assert.equal(f.state.signs, 0);
  }
});
