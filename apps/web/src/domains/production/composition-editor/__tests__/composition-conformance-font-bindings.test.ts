import assert from "node:assert/strict";
import test from "node:test";
import { assertCompiledConformanceFontBindings, assertConformanceFontManifestPin, assertDocumentConformanceFontBindings,
  assertSnapshotFontManifestReuse, conformanceFontManifestHash, conformanceFontPath, normalizeConformanceFontManifest } from "../composition-conformance-font-bindings";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import type { CompositionCompiledFont } from "../../fonts/organization-font.types";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { hashCompositionDocument } from "../composition-document.service";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";

const identifier = "70000000-0000-4000-8000-000000000001";
const font = {fontAssetId: identifier, family: "Pinned Font", checksumSha256: "a".repeat(64), fileSizeBytes: 8, mimeType: "font/woff2" as const};
function fixture() {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {accentColor: "#38BDF8", durationSeconds: 8, title: "Fonts", subtitle: "Pinned"}});
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  clip.source.style.fontAssetId = identifier; clip.source.style.fontFamily = font.family;
  if (track) document.tracks.push(track); document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  return document;
}

test("font identity hashes named fields canonically and rejects duplicates or malformed records", () => {
  const other = {...font, fontAssetId: "70000000-0000-4000-8000-000000000002", family: "Other Font"};
  assert.equal(conformanceFontManifestHash([font, other]), conformanceFontManifestHash([other, Object.fromEntries(Object.entries(font).reverse())]));
  assert.notEqual(conformanceFontManifestHash([font]), conformanceFontManifestHash([{...font, checksumSha256: "b".repeat(64)}]));
  for (const invalid of [[font, font], [{...font, fileSizeBytes: 0}], [{...font, family: ""}], [{...font, mimeType: "text/html"}],
    [{...font, family: "</style><script>"}], [{...font, family: "Bad\nFont"}],
    [{...font, storagePath: "must-not-enter-public-evidence"}]]) assert.throws(() => normalizeConformanceFontManifest(invalid));
});

test("native font IDs and families must be completely covered, including a shared ID with conflicting families", () => {
  const document = fixture();
  assert.deepEqual(assertDocumentConformanceFontBindings(document, [font]), [font]);
  assert.throws(() => assertDocumentConformanceFontBindings(document, []), /DOCUMENT_BINDING_MISMATCH/);
  assert.throws(() => assertDocumentConformanceFontBindings(document, [{...font, family: "Other Font"}]), /DOCUMENT_BINDING_MISMATCH/);
  const copy = structuredClone(document.clips.find((clip) => clip.id === "native")!); copy.id = "other-native";
  if (copy.source.type !== "NATIVE_TEXT") throw new Error("Expected text"); copy.source.style.fontFamily = "Other Font";
  document.clips.push(copy);
  assert.throws(() => assertDocumentConformanceFontBindings(document, [font]), /DOCUMENT_BINDING_MISMATCH/);
});

test("case-equivalent families cannot select different bytes; identical content aliases remain deterministic", () => {
  const document = fixture();
  const second = {...font, fontAssetId: "70000000-0000-4000-8000-000000000002", family: "pinned font"};
  assert.throws(() => assertDocumentConformanceFontBindings(document, [font, {...second, checksumSha256: "b".repeat(64)}]), /FAMILY_AMBIGUOUS/);
  assert.equal(assertDocumentConformanceFontBindings(document, [font, second]).length, 2);
});

test("compiled CSS bindings must have the same identity, format, family and local hashed source", () => {
  const document = fixture();
  const face: CompositionCompiledFont = {assetId: identifier, family: font.family, format: "woff2", sourceUrl: conformanceFontPath(font)};
  assert.doesNotThrow(() => assertCompiledConformanceFontBindings(document, [font], new Map([[identifier, face]])));
  for (const changed of [{...face, sourceUrl: "https://example.invalid/font.woff2"}, {...face, sourceUrl: "assets/fonts/other.woff2"},
    {...face, family: "Other Font"}, {...face, format: "woff" as const}, {...face, assetId: "other-id"}]) {
    assert.throws(() => assertCompiledConformanceFontBindings(document, [font], new Map([[identifier, changed]])), /COMPILED_BINDING_MISMATCH/);
  }
  assert.throws(() => assertCompiledConformanceFontBindings(document, [font], undefined), /COMPILED_BINDING_MISMATCH/);
});

test("font manifest pin cannot be replaced by different bytes or silently omitted records", () => {
  const document = fixture(), hash = conformanceFontManifestHash([font]);
  assert.deepEqual(assertConformanceFontManifestPin(document, [font], hash), [font]);
  assert.throws(() => assertConformanceFontManifestPin(document, [{...font, checksumSha256: "b".repeat(64)}], hash), /PIN_MISMATCH/);
  assert.throws(() => assertConformanceFontManifestPin(document, [], hash), /DOCUMENT_BINDING_MISMATCH/);
  assert.doesNotThrow(() => assertConformanceFontManifestPin(document, [font]));
});

test("snapshot reuse validates exact font identity, not JSON containment supersets", () => {
  assert.doesNotThrow(() => assertSnapshotFontManifestReuse({}, []));
  assert.doesNotThrow(() => assertSnapshotFontManifestReuse({font_manifest: [font]}, [font]));
  assert.throws(() => assertSnapshotFontManifestReuse({}, [font]), /FONT_BINDING_MISMATCH/);
  assert.throws(() => assertSnapshotFontManifestReuse({font_manifest: [font]}, []), /FONT_BINDING_MISMATCH/);
  assert.throws(() => assertSnapshotFontManifestReuse({font_manifest: [{...font, checksumSha256: "b".repeat(64)}]}, [font]), /FONT_BINDING_MISMATCH/);
});

test("source producer freezes the font manifest and its reader requires matching extracted bindings", async () => {
  const document = fixture();
  const contract = buildCompositionConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const fontAssets = new Map<string, CompositionCompiledFont>([[identifier,
    {assetId: identifier, family: font.family, format: "woff2", sourceUrl: conformanceFontPath(font)}]]);
  const source = await buildConformanceReferenceSource({document, contract, assets: [], fontManifest: [font], fontAssets});
  assert.equal(source.metadata.fontManifestSha256, conformanceFontManifestHash([font]));
  assert.deepEqual(verifyConformanceReferenceSource({...source, fontManifest: [font]}).fontManifest, [font]);
  const withoutFontManifest = { ...source };
  delete withoutFontManifest.fontManifest;
  assert.throws(() => verifyConformanceReferenceSource(withoutFontManifest), /FONT_MANIFEST_MISSING/);
  assert.throws(() => verifyConformanceReferenceSource({...source, fontManifest: [{...font, checksumSha256: "b".repeat(64)}]}), /PIN_MISMATCH/);
  await assert.rejects(buildConformanceReferenceSource({document, contract, assets: [], fontManifest: [], fontAssets}), /DOCUMENT_BINDING_MISMATCH/);
});
