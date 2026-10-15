import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { assertGoogleFontFaceMetadata, decodeGoogleFont, decodedGoogleFontSchema, googleFontUnicodeIntervals } from "../google-font-decoding.server";
import { candidateWoff2 } from "./google-font-bundle-fixture";

const geist = () => new Uint8Array(readFileSync(require.resolve("next/dist/compiled/@vercel/og/Geist-Regular.ttf")));
const face = { checksumSha256: "a".repeat(64), fileSizeBytes: 48, mimeType: "font/woff2" as const,
  embeddingCheck: "UNVERIFIED_COMPRESSED" as const, style: "normal" as const,
  weight: { minimum: 400, maximum: 400 }, unicodeRange: "U+0000-00FF" };
const metadata = { family: "Geist", style: "normal", weight: 400, axes: {}, glyphCount: 10,
  coverage: [[32, 126]], decodedBytes: 1000, embedding: "EDITABLE_TABLE_FLAGS" };

test("actually decodes the installed Next Geist TTF, metadata, outlines and character map", async () => {
  const decoded = await decodeGoogleFont(geist(), "font/ttf", new AbortController().signal);
  assert.equal(decoded.family, "Geist"); assert.equal(decoded.style, "normal"); assert.equal(decoded.weight, 400);
  assert.ok(decoded.glyphCount > 100); assert.ok(decoded.coverage.some(([first, last]) => first <= 65 && last >= 65));
  assert.equal(decoded.embedding, "EDITABLE_TABLE_FLAGS");
  assertGoogleFontFaceMetadata("Geist", face, decoded);
});

test("actually decompresses a locally installed controlled-corpus WOFF2 and decodes its glyph outlines", async () => {
  // Same explicit local fixture prerequisite as the controlled render font corpus.
  // No download of fonts or remote provider calls during this test.
  const filename = resolve(process.cwd(), "tools/controlled-hyperframes/node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2");
  const decoded = await decodeGoogleFont(new Uint8Array(readFileSync(filename)), "font/woff2", new AbortController().signal);
  assert.equal(decoded.family, "Space Mono"); assert.equal(decoded.weight, 400); assert.ok(decoded.glyphCount > 100);
  assertGoogleFontFaceMetadata("Space Mono", face, decoded);
});

test("structural header-only WOFF2 fixtures are not admitted as decoded fonts", async () => {
  await assert.rejects(decodeGoogleFont(candidateWoff2(), "font/woff2", new AbortController().signal), /GOOGLE_FONT_DECODING_UNAVAILABLE/);
});

for (const flags of [2, 4, 0x100, 0x200]) test(`rejects decoded TTF embedding flags ${flags}`, async () => {
  const bytes = geist(), view = new DataView(bytes.buffer);
  for (let index = 0; index < view.getUint16(4); index++) {
    const entry = 12 + index * 16;
    if (new TextDecoder().decode(bytes.slice(entry, entry + 4)) === "OS/2") view.setUint16(view.getUint32(entry + 8) + 8, flags);
  }
  await assert.rejects(decodeGoogleFont(bytes, "font/ttf", new AbortController().signal));
});

test("aborts font decoding without exposing worker errors", async () => {
  const controller = new AbortController();
  const pending = decodeGoogleFont(geist(), "font/ttf", controller.signal); controller.abort();
  await assert.rejects(pending, /GOOGLE_FONT_DECODING_UNAVAILABLE/);
});

for (const altered of [
  { ...metadata, family: "Other Family" }, { ...metadata, style: "italic" }, { ...metadata, weight: 700 },
  { ...metadata, coverage: [[0x400, 0x4ff]] }, { ...metadata, embedding: "UNVERIFIED_COMPRESSED" },
]) test(`rejects unbound or unverified face metadata ${JSON.stringify(altered)}`, () => {
  assert.throws(() => assertGoogleFontFaceMetadata("Geist", face, altered));
});

test("checks declared variable weight ranges against the decoded wght axis", () => {
  const variable = { ...metadata, axes: { wght: { name: "Weight", min: 100, default: 400, max: 900 } } };
  assert.doesNotThrow(() => assertGoogleFontFaceMetadata("Geist", { ...face, weight: { minimum: 100, maximum: 900 } }, variable));
  assert.throws(() => assertGoogleFontFaceMetadata("Geist", { ...face, weight: { minimum: 100, maximum: 1000 } }, variable));
});

test("bounded Unicode intervals and coverage reject reversed or overlapping metadata ranges", () => {
  assert.deepEqual(googleFontUnicodeIntervals("U+00??,U+0041-005A,U+1F600"), [[0, 255], [65, 90], [0x1f600, 0x1f600]]);
  assert.deepEqual(googleFontUnicodeIntervals(null), [[0, 0x10ffff]]);
  for (const coverage of [[[100, 99]], [[1, 20], [15, 30]], [[0, 0x110000]], [[0xd800, 0xdfff]], [[0xd700, 0xe000]]])
    assert.equal(decodedGoogleFontSchema.safeParse({ ...metadata, coverage }).success, false);
  for (const invalid of ["U+1?A", "U+??????", "U+110000", "U+FF-00", "</style>"])
    assert.throws(() => googleFontUnicodeIntervals(invalid), /UNICODE_RANGE_INVALID/);
});
