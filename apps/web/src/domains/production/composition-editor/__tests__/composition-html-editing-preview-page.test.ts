import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bindCompositionHtmlPreviewResources } from "../composition-html-editing-preview-bindings.server";
import { buildCompositionHtmlEditingPreviewCsp } from "../composition-html-editing-preview-csp.server";
import { createHtmlPreviewPageHandler } from "../http/composition-html-editing-preview-page-handler.server";
import { resolveHtmlPreviewOperatorConfiguration } from "../composition-html-editing-preview-configuration.server";

const uuid = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const alias = `conformance-media/${uuid}`, font = `assets/fonts/${"a".repeat(64)}.woff2`;
const endpoint = `${audience}/api/production/hyperframes/drafts/${uuid}/html-preview/resources`;
const imageUrl = `${endpoint}?cap=image-capability`, fontUrl = `${endpoint}?cap=font-capability`;
const mapping = new Map([[alias, imageUrl], [font, fontUrl]]);
const config = { key: new Uint8Array(32).fill(7), audience, storageOrigin: "https://storage.test", runtimeWebRoot: process.cwd() };
const session = { version: 1 as const, nonce: "b".repeat(64), documentHash: "c".repeat(64), previewGeneration: 2 };

test("resource binding changes URL sinks only, not text/script/string content or SVG identity, and narrows CSP to one endpoint", () => {
  const compiled = `<html><head><style>@font-face{font-family:Test;src:url("${font}")} .photo{background-image:URL('${alias}');content:'url(${alias})'}</style></head><body>
    <p id="message">${alias}</p><img src="${alias}" style="background:url(${alias});color:red"><svg><use href="#symbol"/><g id="symbol" filter="url(#mask)"/></svg>
    <script>const text=${JSON.stringify(alias)};</script></body></html>`;
  const bound = bindCompositionHtmlPreviewResources({ trustedCompiledPage: compiled, resourceEndpoint: endpoint, resourceUrls: mapping });
  const page = load(bound.html);
  assert.equal(page("img").attr("src"), imageUrl); assert.equal(page("#message").text(), alias);
  assert.equal(page("script").html(), load(compiled)("script").html());
  assert.equal(page("use").attr("href"), "#symbol"); assert.equal(page("#symbol").attr("filter"), "url(#mask)");
  assert.ok(page("style").text().includes(`content:'url(${alias})'`));
  assert.ok(page("style").text().includes(fontUrl)); assert.ok(page("img").attr("style")!.includes(imageUrl));
  assert.deepEqual([...bound.referenced].sort(), [font, alias].sort());
  for (const directive of ["img-src", "media-src", "font-src"]) assert.ok(bound.contentSecurityPolicy.includes(`${directive} ${endpoint};`));
  assert.doesNotMatch(bound.contentSecurityPolicy, /blob:|'unsafe-inline'|allow-same-origin|cap=/);
});

test("bindings reject unknown network/local resources, variable sources and unchecked destination URLs without fallback", () => {
  for (const html of [`<img src="conformance-media/unknown">`, '<img src="https://external.test/image">',
    '<style>@import "https://external.test/font.css";</style>', '<img srcset="unchecked 2x">',
    '<video data-var-src="unchecked"></video>', '<style>.photo{background:url (bad)}</style>']) {
    assert.throws(() => bindCompositionHtmlPreviewResources({ trustedCompiledPage: html, resourceEndpoint: endpoint, resourceUrls: mapping }), /BINDINGS_INVALID/);
  }
  for (const url of ["https://external.test/resource?cap=token", `${endpoint}?actor=forged`, `${endpoint}?cap=a&cap=b`, `${endpoint}#fragment`]) {
    assert.throws(() => bindCompositionHtmlPreviewResources({ trustedCompiledPage: `<img src="${alias}">`, resourceEndpoint: endpoint,
      resourceUrls: new Map([[alias, url]]) }), /BINDINGS_INVALID/);
  }
  for (const source of [audience, endpoint + "?cap=token", "https://user:pass@app.example.test/api/resource", "http://external.test/api/resource"]) {
    assert.throws(() => buildCompositionHtmlEditingPreviewCsp("<html></html>", source), /CSP_REJECTED/);
  }
});

function handlerFixture(responseKind: "PAGE" | "RESOURCE_RENEWAL" = "PAGE") {
  const state = { enabled: true, actorId: uuid as string | null, role: "ADMIN" as string | null,
    tenantId: uuid, tenantUser: uuid, allowed: true, corruptRenewal: false, auth: 0, clients: 0, reads: 0, prepares: 0,
    publishedReads: 0, publishedUnavailable: false, expectedFrozenBundleSha256: undefined as string | undefined };
  const client = { rpc: () => ({ abortSignal: async () => {
    state.reads++; return { error: null, data: [{ allowed: state.allowed, reset_at: "2026-10-08T12:00:00Z" }] };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlPreviewPageHandler({ responseKind, enabled: () => state.enabled, configuration: () => config,
    authenticate: async () => { state.auth++; return { actorId: state.actorId,
      tenant: { organizationId: state.tenantId, userId: state.tenantUser, platformRole: state.role } }; },
    serviceClient: () => { state.clients++; return client; },
    readPublishedPin: async input => {
      state.publishedReads++;
      assert.equal(state.auth, 1); assert.equal(state.reads, 2);
      assert.equal(input.organizationId, uuid); assert.equal(input.documentId, uuid);
      assert.equal(input.revisionId, uuid); assert.equal(input.documentHash, session.documentHash);
      if (state.publishedUnavailable) throw new Error("private metadata");
      return { expectedFrozenBundleSha256: "d".repeat(64), mediaBindings: [], fontManifest: [] };
    },
    prepare: async input => {
      state.prepares++;
      state.expectedFrozenBundleSha256 = input.publishedBinding?.expectedFrozenBundleSha256;
      assert.equal(input.actorId, uuid); assert.equal(input.organizationId, uuid); assert.equal(input.documentId, uuid);
      assert.deepEqual(input.session, session); assert.equal(input.documentHash, session.documentHash);
      return { html: "<!doctype html><html><body>Authorized</body></html>", contentSecurityPolicy: "sandbox allow-scripts",
        session, resourceRenewal: { format: "courseforge-html-preview-resource-renewal-v1" as const, documentId: uuid, session,
          bundleSha256: "d".repeat(64), inventoryFingerprint: "e".repeat(64), issuedAt: 100, expiresAt: 280,
          resources: [{ localPath: alias, url: `${state.corruptRenewal ? "https://foreign.test/resource" : endpoint}?cap=body.signature` }] },
        scope: "AUTHORIZED_RESOURCE_BOUND_PREVIEW_PAGE_NOT_BROWSER_OR_RENDER_EVIDENCE" as const };
    } });
  const url = `${audience}/api/preview?documentHash=${session.documentHash}&r=2&nonce=${session.nonce}`;
  return { state, handle, url };
}

test("historical PAGE and RENEWAL read publication pins after authentication and quotas", async () => {
  for (const kind of ["PAGE", "RESOURCE_RENEWAL"] as const) {
    const f = handlerFixture(kind);
    assert.equal((await f.handle(new Request(f.url + `&revisionId=${uuid}`), { draftId: uuid })).status, 200);
    assert.equal(f.state.publishedReads, 1); assert.equal(f.state.expectedFrozenBundleSha256, "d".repeat(64));
    const unavailable = handlerFixture(kind); unavailable.state.publishedUnavailable = true;
    const response = await unavailable.handle(new Request(unavailable.url + `&revisionId=${uuid}`), { draftId: uuid });
    assert.equal(response.status, 503); assert.equal(unavailable.state.prepares, 0);
    assert.doesNotMatch(await response.text(), /private metadata/);
  }
  const malformed = handlerFixture();
  assert.equal((await malformed.handle(new Request(malformed.url + "&revisionId=forged"), { draftId: uuid })).status, 400);
  assert.equal(malformed.state.auth, 0);
});
test("authenticated page route derives authority, accepts only exact hash/generation/nonce and returns the CSP-bound page", async () => {
  const f = handlerFixture();
  const response = await f.handle(new Request(f.url), { draftId: uuid });
  assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Content-Security-Policy"), "sandbox allow-scripts");
  assert.equal(f.state.reads, 2); assert.equal(f.state.prepares, 1);
  assert.match(await response.text(), /Authorized/);
});
test("page route rejects caller authority, foreign origins and malformed query before authentication", async () => {
  const f = handlerFixture();
  for (const url of [f.url + "&actorId=forged", f.url + "&nonce=duplicate", f.url.replace("r=2", "r=02"),
    f.url.replace("nonce=" + session.nonce, "nonce=short")]) {
    assert.equal((await f.handle(new Request(url), { draftId: uuid })).status, 400);
  }
  assert.equal((await f.handle(new Request(f.url, { headers: { Origin: "https://foreign.test" } }), { draftId: uuid })).status, 403);
  assert.equal(f.state.auth, 0); assert.equal(f.state.clients, 0);
  assert.equal((await f.handle(new Request(f.url, { method: "POST" }), { draftId: uuid })).status, 405);
  f.state.enabled = false;
  assert.equal((await f.handle(new Request(f.url), { draftId: uuid })).status, 503);
});
test("anonymous, non-reviewer, foreign tenant and quota denial never issue preview capabilities", async () => {
  for (const scenario of ["anonymous", "role", "tenant", "quota"]) {
    const f = handlerFixture();
    if (scenario === "anonymous") f.state.actorId = null;
    if (scenario === "role") f.state.role = "student";
    if (scenario === "tenant") f.state.tenantUser = "22222222-2222-4222-8222-222222222222";
    if (scenario === "quota") f.state.allowed = false;
    const response = await f.handle(new Request(f.url), { draftId: uuid });
    assert.equal(response.status, scenario === "anonymous" ? 401 : scenario === "quota" ? 429 : 403);
    assert.equal(f.state.prepares, 0);
  }
});
test("operator configuration validates dedicated keys/canonical origins without deriving them from request headers", () => {
  const valid = { encodedKey: "a".repeat(64), audience, storageOrigin: "https://storage.test/" };
  assert.equal(resolveHtmlPreviewOperatorConfiguration(valid).storageOrigin, "https://storage.test");
  for (const input of [{ ...valid, encodedKey: "short" }, { ...valid, audience: audience + "/path" },
    { ...valid, storageOrigin: "https://storage.test/other" }, { ...valid, storageOrigin: "https://user:pass@storage.test" }]) {
    assert.throws(() => resolveHtmlPreviewOperatorConfiguration(input));
  }
});

test("renewal route shares current authentication and quotas, returns bounded JSON without HTML or Storage claims", async () => {
  const f = handlerFixture("RESOURCE_RENEWAL");
  const response = await f.handle(new Request(f.url), { draftId: uuid });
  assert.equal(response.status, 200); assert.match(response.headers.get("Content-Type")!, /application\/json/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Security-Policy"), null);
  const renewal = await response.json();
  assert.equal(renewal.documentId, uuid); assert.deepEqual(renewal.session, session);
  assert.equal(renewal.expiresAt - renewal.issuedAt, 180);
  assert.equal(renewal.resources.length, 1); assert.equal(f.state.reads, 2); assert.equal(f.state.prepares, 1);
  assert.equal(renewal.html, undefined); assert.equal(renewal.actorId, undefined); assert.equal(renewal.storagePath, undefined);
  f.state.corruptRenewal = true;
  const corrupt = await f.handle(new Request(f.url), { draftId: uuid });
  assert.equal(corrupt.status, 503); assert.doesNotMatch(await corrupt.text(), /foreign\.test|body.signature/);
});

test("renewal does not extend revoked user, role or tenant authorization or bypass the page quota", async () => {
  for (const scenario of ["anonymous", "role", "tenant", "quota"]) {
    const f = handlerFixture("RESOURCE_RENEWAL");
    if (scenario === "anonymous") f.state.actorId = null;
    if (scenario === "role") f.state.role = "student";
    if (scenario === "tenant") f.state.tenantUser = "22222222-2222-4222-8222-222222222222";
    if (scenario === "quota") f.state.allowed = false;
    assert.equal((await f.handle(new Request(f.url), { draftId: uuid })).status,
      scenario === "anonymous" ? 401 : scenario === "quota" ? 429 : 403);
    assert.equal(f.state.prepares, 0);
  }
});
