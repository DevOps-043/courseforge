import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readReadyGoogleFontFaces } from "../google-font-native-face-reader.server";
import { BUNDLE_FONT_ID, BUNDLE_ORG_ID, BUNDLE_ID, BUNDLE_OTHER_ID, BUNDLE_ACTOR_ID } from "./google-font-bundle-fixture";

const pin = { fontId: BUNDLE_FONT_ID, bundleId: BUNDLE_ID, candidateSha256: "a".repeat(64) };
const face = { id: BUNDLE_OTHER_ID, organizationId: BUNDLE_ORG_ID, admissionId: BUNDLE_ACTOR_ID, pin,
  family: "Inter", face: { checksumSha256: "b".repeat(64), fileSizeBytes: 48, mimeType: "font/woff2",
    embeddingCheck: "UNVERIFIED_COMPRESSED", style: "normal", weight: { minimum: 400, maximum: 700 }, unicodeRange: "U+0000-00FF" } };
function fixture() {
  const state = { calls: 0, result: { data: [structuredClone(face)] as unknown, error: null as unknown } };
  const input = { organizationId: BUNDLE_ORG_ID, selection: { pin }, signal: new AbortController().signal,
    supabase: { rpc(name: string, parameters: Record<string, unknown>) {
      state.calls++; assert.equal(name, "read_ready_google_font_faces"); assert.equal(parameters.p_org, BUNDLE_ORG_ID);
      return { async abortSignal(signal: AbortSignal) { signal.throwIfAborted(); return state.result; } };
    } } as unknown as SupabaseClient };
  return { state, input };
}
test("exact pins and immutable face UUIDs round-trip without converting Google into uploaded", async () => {
  const f = fixture(); assert.deepEqual(await readReadyGoogleFontFaces(f.input), [face]);
  assert.deepEqual(await readReadyGoogleFontFaces({ ...f.input, selection: { faceIds: [face.id] } }), [face]);
  assert.equal(f.state.calls, 2);
});
test("rejects malformed, duplicate and empty selections before any database access", async () => {
  const f = fixture();
  for (const ids of [[], [face.id, face.id], ["invalid"], new Array(33).fill(face.id)])
    await assert.rejects(readReadyGoogleFontFaces({ ...f.input, selection: { faceIds: ids } }));
  await assert.rejects(readReadyGoogleFontFaces({ ...f.input, selection: { pin: { ...pin, candidateSha256: "invalid" } } }));
  assert.equal(f.state.calls, 0);
});
test("rejects extra, missing, cross-tenant and different pinned responses", async () => {
  const f = fixture();
  for (const rows of [[], [face, face], [{ ...face, organizationId: BUNDLE_OTHER_ID }],
    [{ ...face, pin: { ...pin, bundleId: BUNDLE_OTHER_ID } }], [{ ...face, unexpected: true }],
    [{ ...face, face: { ...face.face, unicodeRange: "</style>" } }]]) {
    f.state.result.data = rows; await assert.rejects(readReadyGoogleFontFaces(f.input));
  }
  f.state.result.data = [{ ...face, id: BUNDLE_ACTOR_ID }];
  await assert.rejects(readReadyGoogleFontFaces({ ...f.input, selection: { faceIds: [face.id] } }));
});
test("errors, oversized responses and cancellation never become native authority", async () => {
  const f = fixture(); f.state.result.error = { message: "do not expose database internals" };
  await assert.rejects(readReadyGoogleFontFaces(f.input), /GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
  f.state.result.error = null; f.state.result.data = "x".repeat(262145);
  await assert.rejects(readReadyGoogleFontFaces(f.input), /GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE/);
  const controller = new AbortController(); controller.abort(); const calls = f.state.calls;
  await assert.rejects(readReadyGoogleFontFaces({ ...f.input, signal: controller.signal })); assert.equal(f.state.calls, calls);
});
