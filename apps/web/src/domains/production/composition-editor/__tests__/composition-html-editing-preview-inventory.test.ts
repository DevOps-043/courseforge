import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionHtmlEditingPreviewInventory, HTML_EDITING_PREVIEW_RESOURCE_POLICY } from "../composition-html-editing-preview-inventory.server";
import { createTransitionDocument } from "./composition-transition-test-fixtures";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const image = { productionAssetId: id, checksum: "a".repeat(64), fileSizeBytes: 8, mimeType: "image/png",
  storageBucket: "production-assets", storagePath: "html/image.png" };
const font = { id, family: "Pinned Font", checksumSha256: "b".repeat(64), fileSizeBytes: 8, mimeType: "font/woff2",
  storageBucket: "organization-fonts", storagePath: "fonts/pinned.woff2", status: "READY" as const };
function input() {
  return { document: createTransitionDocument(), htmlImages: [image], nativeAssets: [image], nativeDeckPublicUrls: new Map<string, string>(), fonts: [font] };
}

test("preview inventory coalesces exact media identities and separates font/media namespaces without signing", () => {
  const prepared = buildCompositionHtmlEditingPreviewInventory(input());
  assert.equal(prepared.entries.length, 2); assert.equal(prepared.totalBytes, 16);
  assert.equal(prepared.assetUrls.get(id), `conformance-media/${id}`);
  assert.equal(prepared.fonts.get(id)?.sourceUrl, `assets/fonts/${font.checksumSha256}.woff2`);
});

test("inventory rejects checksum/size/MIME/Storage disagreements for a shared media UUID", () => {
  for (const mutation of [{ checksum: "f".repeat(64) }, { fileSizeBytes: 9 }, { mimeType: "image/jpeg" },
    { storagePath: "other.png" }, { storageBucket: "production-render-sources" }]) {
    const prepared = input(); prepared.nativeAssets = [{ ...image, ...mutation }];
    assert.throws(() => buildCompositionHtmlEditingPreviewInventory(prepared), /HTML_EDITING_PREVIEW_INVENTORY_INVALID/);
  }
});

test("inventory charges the combined budget rather than granting each producer a separate allowance", () => {
  const prepared = input();
  prepared.nativeAssets = [{ ...image, productionAssetId: other, mimeType: "video/mp4", fileSizeBytes: HTML_EDITING_PREVIEW_RESOURCE_POLICY.totalBytes }];
  assert.throws(() => buildCompositionHtmlEditingPreviewInventory(prepared));
});

test("font content aliases coalesce deterministically, but cannot disagree about content length or Storage policy", () => {
  const prepared = input(), alias = { ...font, id: other, family: "Alias Font", storagePath: "fonts/alias.woff2" };
  prepared.fonts.push(alias);
  const first = buildCompositionHtmlEditingPreviewInventory(prepared);
  const reordered = buildCompositionHtmlEditingPreviewInventory({ ...prepared, fonts: [...prepared.fonts].reverse() });
  assert.equal(first.fingerprint, reordered.fingerprint); assert.equal(first.entries.length, 2);
  assert.equal(first.fonts.size, 2);
  assert.throws(() => buildCompositionHtmlEditingPreviewInventory({ ...prepared, fonts: [font, { ...alias, fileSizeBytes: 9 }] }));
  assert.throws(() => buildCompositionHtmlEditingPreviewInventory({ ...prepared, fonts: [{ ...font, storageBucket: "production-assets" }] }));
});

test("legacy deck URL mappings are bounded mapping keys, not grants, and conflicting mappings reject", () => {
  const prepared = input(); prepared.nativeDeckPublicUrls.set(id, "https://storage.example.test/image.png");
  assert.equal(buildCompositionHtmlEditingPreviewInventory(prepared).deckAssetUrls.get("https://storage.example.test/image.png"), `conformance-media/${id}`);
  prepared.nativeDeckPublicUrls.set(other, "https://storage.example.test/image.png");
  assert.throws(() => buildCompositionHtmlEditingPreviewInventory(prepared));
});
