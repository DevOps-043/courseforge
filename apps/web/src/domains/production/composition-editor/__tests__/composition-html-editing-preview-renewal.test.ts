import assert from "node:assert/strict";
import test from "node:test";
import { HTML_PREVIEW_RENEWAL_POLICY, parseHtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.contract";
import { consultHtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.client";

const documentId = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const session = { version: 1 as const, documentHash: "a".repeat(64), nonce: "b".repeat(64), previewGeneration: 3 };
const expected = { documentId, audience, session, bundleSha256: "c".repeat(64), inventoryFingerprint: "d".repeat(64) };
const renewal = { format: "courseforge-html-preview-resource-renewal-v1", documentId, session,
  bundleSha256: expected.bundleSha256, inventoryFingerprint: expected.inventoryFingerprint, issuedAt: 100, expiresAt: 280,
  resources: [{ localPath: `conformance-media/${documentId}`,
    url: `${audience}/api/production/hyperframes/drafts/${documentId}/html-preview/resources?cap=body.signature` }] };

test("historical renewal preserves revision identity and rejects malformed identity before fetching", async () => {
  let calls = 0;
  const revisionId = "22222222-2222-4222-8222-222222222222";
  const fetcher = (async (url: string) => {
    calls++; assert.equal(new URL(url, audience).searchParams.get("revisionId"), revisionId);
    return Response.json(renewal);
  }) as typeof fetch;
  assert.deepEqual(await consultHtmlPreviewResourceRenewal({ ...expected, revisionId, fetcher, nowSeconds: () => 200 }), renewal);
  await assert.rejects(consultHtmlPreviewResourceRenewal({ ...expected, revisionId: "forged", fetcher }), /RENEWAL_UNAVAILABLE/);
  assert.equal(calls, 1);
});

test("renewal contract binds session, issuer endpoint, bundle and inventory without treating URLs as grants", () => {
  const parsed = parseHtmlPreviewResourceRenewal(renewal, expected);
  assert.deepEqual(parsed, renewal);
  parsed.resources.length = 0; assert.equal(renewal.resources.length, 1);
  for (const change of [{ documentId: "22222222-2222-4222-8222-222222222222" }, { bundleSha256: "e".repeat(64) },
    { inventoryFingerprint: "e".repeat(64) }, { session: { ...session, nonce: "e".repeat(64) } },
    { expiresAt: 281 }, { actorId: "forged" }, { resources: [...renewal.resources, ...renewal.resources] }])
    assert.throws(() => parseHtmlPreviewResourceRenewal({ ...renewal, ...change }, expected), /^Error: HTML_PREVIEW_RENEWAL_INVALID$/);
});

test("renewal contract rejects malformed capability URLs, unchecked aliases and oversized/cyclic bodies safely", () => {
  const original = renewal.resources[0]!;
  for (const url of [original.url.replace(audience, "https://foreign.test"), original.url + "&actor=forged",
    original.url + "&cap=duplicate", original.url + "#secret", original.url.replace("body.signature", "bad-token"),
    original.url.replace("/resources?", "/renew?"), original.url.replace("https://", "https://user:pass@")])
    assert.throws(() => parseHtmlPreviewResourceRenewal({ ...renewal, resources: [{ ...original, url }] }, expected), /RENEWAL_INVALID/);
  assert.throws(() => parseHtmlPreviewResourceRenewal({ ...renewal,
    resources: [{ ...original, localPath: "../private" }] }, expected), /RENEWAL_INVALID/);
  assert.throws(() => parseHtmlPreviewResourceRenewal({ ...renewal, extra: "x".repeat(HTML_PREVIEW_RENEWAL_POLICY.responseBytes) }, expected), /RENEWAL_INVALID/);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  assert.throws(() => parseHtmlPreviewResourceRenewal(cyclic, expected), /^Error: HTML_PREVIEW_RENEWAL_INVALID$/);
});

test("renewal client makes one credentialed exact-session read with no redirects or cache", async () => {
  let calls = 0;
  const fetcher = (async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, `/api/production/hyperframes/drafts/${documentId}/html-preview/renew?documentHash=${session.documentHash}&r=3&nonce=${session.nonce}`);
    assert.equal(options.method, "GET"); assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store"); assert.equal(options.body, undefined);
    return Response.json(renewal);
  }) as typeof fetch;
  assert.deepEqual(await consultHtmlPreviewResourceRenewal({ ...expected, fetcher, nowSeconds: () => 200 }), renewal);
  assert.equal(calls, 1);
});

test("renewal client rejects expiry, future issuance, bad responses, drift and cancellation without retry or provider leaks", async () => {
  for (const scenario of ["expired", "near-expiry", "future", "http", "drift", "oversized", "cancelled", "preabort"]) {
    let calls = 0; const controller = new AbortController();
    if (scenario === "preabort") controller.abort();
    const fetcher = (async () => {
      calls++; if (scenario === "cancelled") controller.abort();
      if (scenario === "http") return Response.json({ private: "provider details" }, { status: 403 });
      if (scenario === "oversized") return new Response("x".repeat(HTML_PREVIEW_RENEWAL_POLICY.responseBytes + 1),
        { headers: { "content-type": "application/json" } });
      return Response.json(scenario === "drift" ? { ...renewal, inventoryFingerprint: "e".repeat(64) } : renewal);
    }) as typeof fetch;
    await assert.rejects(consultHtmlPreviewResourceRenewal({ ...expected, fetcher, signal: controller.signal,
      nowSeconds: () => scenario === "expired" ? 280 : scenario === "near-expiry" ? 251 : scenario === "future" ? 99 : 200 }),
    /^Error: HTML_PREVIEW_RENEWAL_UNAVAILABLE$/);
    assert.equal(calls, scenario === "preabort" ? 0 : 1);
  }
});
