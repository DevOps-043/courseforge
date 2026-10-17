import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { verifyDeclaredFontFaces, verifyConformanceFontLoading } from "../qa/composition-font-loading-capture";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";
import type { ConformanceFontManifest } from "../composition-conformance-font-bindings";

function face(family: string, outcome: "loaded" | "error" | "pending" = "loaded") {
  const entry = {family, status: "unloaded", calls: 0, async load() {
    entry.calls++;
    if (outcome === "error") {entry.status = "error"; throw new Error("decoder rejected private font");}
    if (outcome === "pending") return new Promise(() => undefined);
    entry.status = "loaded"; return entry;
  }};
  return entry;
}
function read(faces: ReturnType<typeof face>[], families: string[], load = true, maximumFaces = 128) {
  return runInNewContext(`(${verifyDeclaredFontFaces.toString()})(${JSON.stringify(families)},${load},${JSON.stringify({maximumFaces, timeoutMilliseconds: 10})})`, {
    document: {fonts: faces}, setTimeout, clearTimeout,
  }) as Promise<boolean>;
}

test("existing declared faces load explicitly, including quoted/case-equivalent aliases and duplicate declarations", async () => {
  const faces = [face('"Editorial"'), face("EDITORIAL"), face("Unrelated deck")];
  assert.equal(await read(faces, ["Editorial"]), true);
  assert.deepEqual(faces.map((entry) => entry.calls), [1, 1, 0]);
  assert.equal(await read(faces, ["Editorial"], false), true);
  assert.deepEqual(faces.map((entry) => entry.calls), [1, 1, 0]);
});

test("missing declarations and failed font decoding cannot borrow a fulfilled FontFaceSet.ready", async () => {
  await assert.rejects(read([], ["Missing"]), /CONFORMANCE_FONT_FACE_MISSING/);
  await assert.rejects(read([face("Editorial", "error")], ["Editorial"]), /decoder rejected/);
  await assert.rejects(read([face("Editorial")], ["Editorial"], false), /CONFORMANCE_FONT_FACE_NOT_LOADED/);
});

test("a face loading stall and excessive face inventory reject within bounded limits", async () => {
  await assert.rejects(read([face("Editorial", "pending")], ["Editorial"]), /CONFORMANCE_FONT_LOAD_TIMEOUT/);
  await assert.rejects(read([face("Editorial"), face("Other")], ["Editorial"], true, 1), /CONFORMANCE_FONT_FACE_LIMIT/);
});

test("checkpoint verification rejects a font which changes from loaded to error without reloading it", async () => {
  const entry = face("Editorial");
  assert.equal(await read([entry], ["Editorial"]), true);
  entry.status = "error";
  await assert.rejects(read([entry], ["Editorial"], false), /CONFORMANCE_FONT_FACE_NOT_LOADED/);
  assert.equal(entry.calls, 1);
});

test("CDP verification requires exact true, hides exception details and skips only an empty manifest", async () => {
  const fonts: ConformanceFontManifest = [{family: "Editorial", checksumSha256: "a".repeat(64),
    fontAssetId: "70000000-0000-4000-8000-000000000001", fileSizeBytes: 100, mimeType: "font/woff2"}];
  const expressions: string[] = [];
  let response: Record<string, unknown> = {result: {value: true}};
  const client: CompositionQaCdpClient = {close() {}, async send(method, params) {
    assert.equal(method, "Runtime.evaluate"); assert.equal(params?.awaitPromise, true);
    expressions.push(String(params?.expression)); return response;
  }};
  await verifyConformanceFontLoading(client, [], true); assert.equal(expressions.length, 0);
  await verifyConformanceFontLoading(client, fonts, true);
  assert.ok(expressions[0]?.includes("verifyDeclaredFontFaces"));
  for (const invalid of [{}, {result: {value: false}}, {result: {value: "true"}},
    {result: {value: true}, exceptionDetails: {text: "private document URL"}}]) {
    response = invalid;
    await assert.rejects(verifyConformanceFontLoading(client, fonts, false), /^Error: CONFORMANCE_CAPTURE_FONT_LOADING_FAILED$/);
  }
});
