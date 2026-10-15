import assert from "node:assert/strict";
import test from "node:test";
import { inspectRegisteredGoogleFont } from "../google-font-preparation-query.server";
import { requestGoogleFontPreparation } from "../google-font-preparation.client";
import { createGoogleFontBundleFixture, BUNDLE_FONT_ID, BUNDLE_OTHER_ID } from "./google-font-bundle-fixture";

async function withFetch(fake: typeof fetch, operation: () => Promise<void>) {
  const original = globalThis.fetch; globalThis.fetch = fake;
  try { await operation(); } finally { globalThis.fetch = original; }
}

test("client sends only an explicit reviewed hash when saving and validates the receipt", async () => {
  const fixture = await createGoogleFontBundleFixture();
  await withFetch(async (url, options) => {
    assert.equal(String(url), `/api/admin/fonts/${BUNDLE_FONT_ID}/google-preparation`);
    assert.deepEqual(JSON.parse(String(options?.body)), { persist: true, expectedCandidateSha256: fixture.identity.candidateSha256 });
    assert.equal(options?.credentials, "same-origin"); assert.equal(options?.method, "POST");
    return Response.json({ success: true, bundle: { bundleId: BUNDLE_FONT_ID, candidateSha256: fixture.identity.candidateSha256,
      status: "PREPARED", renderEligible: false, created: true } });
  }, async () => {
    const result = await requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, fixture.identity.candidateSha256);
    assert.equal(result.kind, "BUNDLE");
  });
});

test("client inspection sends {} and rejects a response for another selected font", async () => {
  const fixture = await createGoogleFontBundleFixture(), result = await inspectRegisteredGoogleFont(fixture.input);
  if (!result.ok) assert.fail("fixture unavailable");
  await withFetch(async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), {});
    return Response.json({ success: true, preparation: result.candidate });
  }, async () => assert.equal((await requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal)).kind, "PREPARATION"));
  await withFetch(async () => Response.json({ success: true, preparation: { ...result.candidate, fontId: fixture.input.actorId } }),
    async () => assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal), /no corresponde/));
});

test("client rejects a mismatched digest or claimed native activation in a save receipt", async () => {
  const fixture = await createGoogleFontBundleFixture();
  for (const changes of [{ candidateSha256: "f".repeat(64) }, { renderEligible: true }, { status: "READY" }]) {
    await withFetch(async () => Response.json({ success: true, bundle: { bundleId: BUNDLE_FONT_ID,
      candidateSha256: fixture.identity.candidateSha256, status: "PREPARED", renderEligible: false, created: true, ...changes } }),
    async () => assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, fixture.identity.candidateSha256)));
  }
});

test("client preserves unknown-outcome server messaging without retrying POST", async () => {
  const fixture = await createGoogleFontBundleFixture(); let calls = 0;
  await withFetch(async () => { calls++; return Response.json({ message: "No se pudo confirmar el guardado." }, { status: 503 }); },
    async () => assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, fixture.identity.candidateSha256), /No se pudo confirmar/));
  assert.equal(calls, 1);
});

test("client bounds streamed responses and releases the reader", async () => {
  const fixture = await createGoogleFontBundleFixture(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await withFetch(async () => new Response(body, { headers: { "content-type": "application/json" } }),
    async () => assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal), /excede el límite/));
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});

test("invalid client IDs or empty reviewed digest fail without fetching", async () => {
  const fixture = await createGoogleFontBundleFixture();
  await withFetch(async () => { assert.fail("must not fetch"); }, async () => {
    await assert.rejects(requestGoogleFontPreparation("../other", fixture.input.signal));
    await assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, ""));
  });
});

test("client explicitly validates the saved candidate and binds the decoded receipt to the reviewed font/hash", async () => {
  const fixture = await createGoogleFontBundleFixture();
  const admission = { admissionId: BUNDLE_OTHER_ID, bundleId: BUNDLE_OTHER_ID, fontId: BUNDLE_FONT_ID,
    candidateSha256: fixture.identity.candidateSha256, status: "READY", faceIds: [BUNDLE_OTHER_ID], created: true,
    scope: "DECODED_FONT_FILES_NOT_RENDER_ATTESTATION" };
  await withFetch(async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), { admit: true, expectedCandidateSha256: fixture.identity.candidateSha256 });
    return Response.json({ success: true, admission });
  }, async () => assert.equal((await requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, fixture.identity.candidateSha256, "admit")).kind, "ADMISSION"));
  for (const changed of [{ ...admission, fontId: BUNDLE_OTHER_ID }, { ...admission, candidateSha256: "f".repeat(64) },
    { ...admission, scope: "RENDER_VERIFIED" }, { ...admission, faceIds: [BUNDLE_OTHER_ID, BUNDLE_OTHER_ID] }])
    await withFetch(async () => Response.json({ success: true, admission: changed }), async () =>
      assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, fixture.identity.candidateSha256, "admit")));
  await withFetch(async () => { assert.fail("must not acquire without a reviewed candidate"); }, async () =>
    assert.rejects(requestGoogleFontPreparation(BUNDLE_FONT_ID, fixture.input.signal, undefined, "admit")));
});
