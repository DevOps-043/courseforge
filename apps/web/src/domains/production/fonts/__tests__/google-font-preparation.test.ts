import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { GOOGLE_FONT_PREPARATION_POLICY, googleFontBinaryExtension, googleFontPreparationInputSchema } from "../google-font-preparation-policy";
import { parseGoogleFontStylesheet } from "../google-font-stylesheet";
import { prepareGoogleFontBytes } from "../google-font-preparation.server";
import { inspectRegisteredGoogleFont } from "../google-font-preparation-query.server";

const cssUrl = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap";
const binaryUrl = "https://fonts.gstatic.com/s/inter/v18/Regular.ttf";
const boldUrl = "https://fonts.gstatic.com/s/inter/v18/Bold.ttf";
const fontId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const face = (url = binaryUrl, descriptors = "font-weight:400;") => `@font-face {font-family:'Inter';font-style:normal;${descriptors}src:url(${url}) format('truetype');}`;
const input = { family: "Inter", cssUrl };

for (const url of [
  "http://fonts.googleapis.com/css2?family=Inter", "https://fonts.googleapis.com.evil.test/css2?family=Inter",
  "https://fonts.googleapis.com:8443/css2?family=Inter", "https://user@fonts.googleapis.com/css2?family=Inter",
  "https://fonts.googleapis.com/anything?family=Inter", "https://fonts.googleapis.com/css2?family=Inter#fragment",
  "https://fonts.googleapis.com/css2?family=Inter&family=Other", "https://fonts.googleapis.com/css2?family=Other",
  "https://fonts.googleapis.com/css2?family=Inter&text=Hola", "https://fonts.googleapis.com/css2?family=Inter&callback=evil",
  "https://fonts.googleapis.com/css2?family=Inter|Other", "https://fonts.googleapis.com/css2?family=Inter&display=evil",
]) test(`rejects stylesheet request outside the preparation policy: ${url}`, () => {
  assert.equal(googleFontPreparationInputSchema.safeParse({ ...input, cssUrl: url }).success, false);
});

test("accepts bounded CSS v1/v2 requests for one exact family, including variable axes", () => {
  for (const url of [cssUrl, "https://fonts.googleapis.com/css?family=Inter:400,700&subset=latin,latin-ext",
    "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400..700;1,400..700"]) {
    assert.equal(googleFontPreparationInputSchema.safeParse({ ...input, cssUrl: url }).success, true);
  }
});

for (const url of ["https://fonts.gstatic.com.evil.test/s/inter/v18/Regular.ttf", "https://fonts.gstatic.com:8443/s/inter/v18/Regular.ttf",
  "http://fonts.gstatic.com/s/inter/v18/Regular.ttf", "https://user@fonts.gstatic.com/s/inter/v18/Regular.ttf",
  `${binaryUrl}?token=unsafe`, `${binaryUrl}#hash`, "https://fonts.gstatic.com/font?kit=subset",
  "https://fonts.gstatic.com/s/inter/v18/../Regular.ttf", "https://127.0.0.1/s/inter/v18/Regular.ttf"]) {
  test(`rejects unapproved binary location: ${url}`, () => assert.throws(() => googleFontBinaryExtension(url)));
}

test("retains normal/italic, variable weights and separate unicode subsets", () => {
  const css = `/* latin */${face(binaryUrl, "font-weight:400 700;unicode-range:U+0000-00FF;")}
    ${face(boldUrl, "font-weight:400 700;unicode-range:U+0400-04FF;").replace("font-style:normal", "font-style:italic")}`;
  assert.deepEqual(parseGoogleFontStylesheet(css, "Inter").map(font => [font.style, font.weight, font.unicodeRange]), [
    ["normal", { minimum: 400, maximum: 700 }, "U+0000-00FF"], ["italic", { minimum: 400, maximum: 700 }, "U+0400-04FF"],
  ]);
});

for (const css of [
  `${face()}@import url(https://evil.test);`, `${face()}.x {color:red}`, face().replace("'Inter'", "'Other'"),
  face().replace("font-style:normal", "font-style:oblique"), face(binaryUrl, "font-weight:700 400;"),
  face(binaryUrl, "font-weight:0;"), face(binaryUrl, "font-weight:1001;"), face(binaryUrl, "font-weight:400;font-weight:700;"),
  face(binaryUrl, "font-weight:400;unicode-range:U+FF-01;"), face(binaryUrl, "font-weight:400;unicode-range:U+110000;"),
  face().replace("format('truetype')", "format('woff2')"), face().replace(`url(${binaryUrl})`, `local('Inter'),url(${binaryUrl})`),
  face().replace("src:", "unexpected:unsafe;src:"), `${face()}${face()}`, `${face()}/*unterminated`,
  face().replace("'Inter'", "'Inter\\0'"), face(binaryUrl, "font-weight:400;font-stretch:75%;"),
]) test(`rejects stylesheet constructs that cannot become explicit face data: ${css.slice(-70)}`, () => {
  assert.throws(() => parseGoogleFontStylesheet(css, "Inter"));
});

test("rejects oversized stylesheets and excessive face counts", () => {
  assert.throws(() => parseGoogleFontStylesheet(" ".repeat(GOOGLE_FONT_PREPARATION_POLICY.stylesheetBytes + 1), "Inter"));
  assert.throws(() => parseGoogleFontStylesheet(Array.from({ length: 33 }, (_, index) => face(binaryUrl, `font-weight:${index + 1};`)).join(""), "Inter"));
});

test("downloads each URL once and pins complete candidate bytes without native admission", async () => {
  const font = structuralTtf(), css = `${face()}${face(binaryUrl, "font-weight:700;")}${face(boldUrl, "font-weight:800;")}`;
  const calls: string[] = [];
  const result = await prepareGoogleFontBytes(input, { fetchImpl: async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit"); assert.equal(options?.cache, "no-store");
    assert.deepEqual(Object.keys(options?.headers ?? {}), ["Accept"]);
    return String(url) === cssUrl ? response(css, "text/css") : response(font, "font/ttf");
  } });
  assert.deepEqual(calls, [cssUrl, binaryUrl, boldUrl]);
  assert.equal(result.source, "google"); assert.equal(result.scope, "STRUCTURAL_CANDIDATE_BYTES_NOT_NATIVE_AUTHORITY");
  assert.equal(result.files.length, 2); assert.equal(result.faces.length, 3); assert.equal(result.totalBytes, font.length * 2);
  assert.equal(result.stylesheetChecksumSha256, hash(new TextEncoder().encode(css)));
  assert.equal(result.faces[0].checksumSha256, hash(font)); assert.deepEqual(result.files[0].bytes, font);
  assert.equal("renderEligible" in result, false);
});

test("a compressed structural candidate remains explicitly unverified, not READY", async () => {
  const bytes = new Uint8Array(48); bytes.set(new TextEncoder().encode("wOF2"));
  new DataView(bytes.buffer).setUint32(8, bytes.length); new DataView(bytes.buffer).setUint16(12, 1);
  const css = face(binaryUrl.replace("ttf", "woff2")).replace("truetype", "woff2");
  const result = await prepareGoogleFontBytes(input, { fetchImpl: async url => String(url) === cssUrl ? response(css, "text/css") : response(bytes, "font/woff2") });
  assert.equal(result.faces[0].embeddingCheck, "UNVERIFIED_COMPRESSED");
});

for (const [name, badResponse] of [
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.test" } })],
  ["wrong MIME", () => response("HTML", "text/html")],
  ["range", () => new Response(face(), { headers: { "content-type": "text/css", "content-range": "bytes 0-10/99" } })],
  ["excessive declared length", () => new Response(face(), { headers: { "content-type": "text/css", "content-length": "999999" } })],
  ["invalid declared length", () => new Response(face(), { headers: { "content-type": "text/css", "content-length": "NaN" } })],
  ["truncated declared length", () => new Response(face(), { headers: { "content-type": "text/css", "content-length": "10" } })],
  ["empty body", () => new Response(null, { headers: { "content-type": "text/css" } })],
] as const) test(`rejects ${name} without continuing to binary acquisition`, async () => {
  let count = 0;
  await assert.rejects(prepareGoogleFontBytes(input, { fetchImpl: async () => { count++; return badResponse(); } }), /GOOGLE_FONT_PREPARATION_UNAVAILABLE/);
  assert.equal(count, 1);
});

test("enforces streamed stylesheet limit and cancels on failure", async () => {
  let cancelled = false;
  await assert.rejects(prepareGoogleFontBytes(input, { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(GOOGLE_FONT_PREPARATION_POLICY.stylesheetBytes + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "text/css" } }) }));
  assert.equal(cancelled, true);
});

test("aborts a stalled response body and releases its reader", async () => {
  const controller = new AbortController(); let cancelled = false;
  const responseStream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const pending = prepareGoogleFontBytes(input, { signal: controller.signal, fetchImpl: async () => {
    setImmediate(() => controller.abort(new Error("caller_cancelled")));
    return new Response(responseStream, { headers: { "content-type": "text/css" } });
  } });
  await assert.rejects(pending, /caller_cancelled/);
  assert.equal(cancelled, true); assert.equal(responseStream.locked, false);
});

test("rejects signature mismatches and internally restricted embedding", async () => {
  for (const bytes of [new Uint8Array(58), structuralTtf(0x0002)]) {
    await assert.rejects(prepareGoogleFontBytes(input, { fetchImpl: async url => String(url) === cssUrl ? response(face(), "text/css") : response(bytes, "font/ttf") }));
  }
});

test("bounds total downloaded font bytes before a third large file", async () => {
  const thirdUrl = binaryUrl.replace("Regular", "Third");
  const css = `${face()}${face(boldUrl, "font-weight:700;")}${face(thirdUrl, "font-weight:800;")}`;
  let count = 0;
  await assert.rejects(prepareGoogleFontBytes(input, { fetchImpl: async url => {
    count++;
    return String(url) === cssUrl ? response(css, "text/css") : response(structuralTtf(0, 10 * 1024 * 1024), "font/ttf");
  } }));
  assert.equal(count, 3);
});

test("registered tenant query returns no files, URLs or render permission", async () => {
  const result = await inspectRegisteredGoogleFont({ fontId, organizationId, signal: new AbortController().signal,
    repository: { readFont: async (org, id) => { assert.equal(org, organizationId); assert.equal(id, fontId); return registered(); } },
    fetchImpl: async url => String(url) === cssUrl ? response(face(), "text/css") : response(structuralTtf(), "font/ttf"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.candidate.renderEligible, false);
  assert.equal(result.candidate.status, "NATIVE_BUNDLE_INTEGRATION_REQUIRED");
  assert.doesNotMatch(JSON.stringify(result), /sourceUrl|cssUrl|bytes|fonts\.gstatic/);
});

for (const [name, row] of [
  ["other tenant", registered({ organization_id: otherId })], ["wrong ID", registered({ id: otherId })],
  ["revoked", registered({ status: "REJECTED" })], ["uploaded", registered({ source: "uploaded" })],
  ["modified family", registered({ family: "Other" })], ["subset for fixed text", registered({ css_url: `${cssUrl}&text=Hola` })],
  ["absent", null],
] as const) test(`does not fetch a ${name} registry row`, async () => {
  const result = await inspectRegisteredGoogleFont({ fontId, organizationId, signal: new AbortController().signal,
    repository: { readFont: async () => row }, fetchImpl: async () => { assert.fail("must not fetch"); } });
  assert.equal(result.ok, false);
});

function registered(overrides: Record<string, unknown> = {}) {
  return { id: fontId, organization_id: organizationId, family: "Inter", source: "google", css_url: cssUrl, status: "READY", ...overrides };
}
function response(body: string | Uint8Array, mimeType: string) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body).buffer, { headers: { "content-type": mimeType } });
}
// Structural fixture only: it is intentionally not glyph/decode/render evidence.
function structuralTtf(fsType = 0, size = 58) {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000); view.setUint16(4, 2);
  bytes.set(new TextEncoder().encode("name"), 12); view.setUint32(20, 44); view.setUint32(24, 4);
  bytes.set(new TextEncoder().encode("OS/2"), 28); view.setUint32(36, 48); view.setUint32(40, 10); view.setUint16(56, fsType);
  return bytes;
}
