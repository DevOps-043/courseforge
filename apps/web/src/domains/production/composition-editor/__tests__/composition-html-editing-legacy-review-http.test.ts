import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlLegacyReviewHandler } from "../http/composition-html-editing-legacy-review-handler.server";
import { describeHtmlLegacySourceChange } from "../composition-html-editing-legacy-review.contract";
import { HtmlLegacyAdoptionPersistenceError } from "../composition-html-editing-legacy-adoption-repository.server";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const params = { draftId: uuid, clipId: "slide_intro", candidateId: other };
const url = `https://app.example/api/review?expectedDocumentHash=${"a".repeat(64)}`;
function fixture() {
  const originalSource = "<div>Original</div>", candidateSource = '<div data-hf-editable="title">Original</div>';
  const hash = (source: string) => createHash("sha256").update(source).digest("hex");
  const view = { scope: "REVIEWED_HTML_CANDIDATE_NOT_COMMITTED_OR_RENDERED", organizationId: uuid, documentId: uuid, clipId: params.clipId, actorId: uuid,
    request: { candidateId: other, provenanceSha256: "b".repeat(64), expectedDocumentHash: "a".repeat(64) },
    templateId: "legacy_intro", templateVersion: 1, evidenceSha256: "c".repeat(64),
    completedReviews: ["VISUAL_COMPARISON", "MANIFEST_AND_ACCESSIBILITY", "AUTHORIZED_INSTALLATION"],
    originalSourceSha256: hash(originalSource), candidateSourceSha256: hash(candidateSource), proposedDocumentHash: "d".repeat(64),
    originalSource, candidateSource, fields: [{ elementId: "title", kind: "TEXT", label: "Título" }] };
  const calls: string[] = [];
  const state = { enabled: true, actorId: uuid as string | null, organizationId: uuid, tenantActor: uuid, role: "ADMIN", allowed: true,
    result: view as unknown, fail: false, failure: null as Error | null };
  const client = { rpc: (name: string, parameters: Record<string, unknown>) => ({ abortSignal: async () => {
    assert.equal(name, "consume_api_rate_limit"); assert.equal(parameters.p_window_seconds, 60);
    calls.push("quota"); return { data: [{ allowed: state.allowed, reset_at: "2026-10-09T00:00:00Z" }], error: null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlLegacyReviewHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push("auth"); return { actorId: state.actorId,
      tenant: { organizationId: state.organizationId, userId: state.tenantActor, platformRole: state.role } }; },
    serviceClient: () => { calls.push("service"); return client; },
    read: async (_client, command, signal) => { signal.throwIfAborted(); calls.push("read");
      assert.equal(command.actorId, uuid); assert.equal(command.organizationId, uuid); assert.equal(command.documentId, uuid);
      if (state.failure) throw state.failure;
      if (state.fail) throw new Error("PRIVATE_APPROVAL_SOURCE"); return state.result; },
  });
  return { state, view, calls, handle };
}

test("review HTTP is no-store read-only, tenant-derived and bounded by two quotas", async () => {
  const f = fixture(), response = await f.handle(new Request(url), params);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(f.calls, ["auth", "service", "quota", "quota", "read"]);
  assert.deepEqual((await response.json()).data, f.view);
});

test("review method, gates, query and origins reject before authentication", async () => {
  for (const [request, expected] of [[new Request(url, { method: "POST" }), 405],
    [new Request(url, { headers: { origin: "https://foreign.example" } }), 403],
    [new Request(url, { headers: { "sec-fetch-site": "cross-site" } }), 403],
    [new Request(`${url}&expectedDocumentHash=${"a".repeat(64)}`), 400],
    [new Request(`${url}&approval=true`), 400], [new Request("https://app.example/api/review"), 400]] as const) {
    const f = fixture(); assert.equal((await f.handle(request, params)).status, expected); assert.deepEqual(f.calls, []);
  }
  const f = fixture(); f.state.enabled = false;
  assert.equal((await f.handle(new Request(url), params)).status, 503); assert.deepEqual(f.calls, []);
});

test("review rejects missing authentication, mismatched membership, role, quota and swapped response", async () => {
  for (const failure of ["auth", "membership", "role", "quota", "response"] as const) {
    const f = fixture();
    if (failure === "auth") f.state.actorId = null;
    else if (failure === "membership") f.state.tenantActor = other;
    else if (failure === "role") f.state.role = "BUILDER";
    else if (failure === "quota") f.state.allowed = false;
    else f.state.result = { ...f.view, organizationId: other };
    const response = await f.handle(new Request(url), params);
    assert.equal(response.status, failure === "auth" ? 401 : failure === "quota" ? 429 : failure === "response" ? 503 : 403);
    if (["auth", "membership", "role"].includes(failure)) assert.deepEqual(f.calls, ["auth"]);
    if (failure === "quota") assert.equal(f.calls.includes("read"), false);
  }
});

test("review errors never expose source or operator internals", async () => {
  const f = fixture(); f.state.fail = true;
  const response = await f.handle(new Request(url), params);
  assert.equal(response.status, 503); assert.equal(JSON.stringify(await response.json()).includes("PRIVATE"), false);
});

test("shared read handler preserves candidate conflict versus unavailable semantics", async () => {
  for (const code of ["CONFLICT", "READ_UNAVAILABLE"] as const) {
    const f = fixture(); f.state.failure = new HtmlLegacyAdoptionPersistenceError(code);
    const response = await f.handle(new Request(url), params);
    assert.equal(response.status, code === "CONFLICT" ? 409 : 503);
    assert.equal((await response.json()).retryable, false);
  }
});

test("review rejects an aborted request before authentication and invalid path scope", async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  assert.equal((await f.handle(new Request(url, { signal: abort.signal }), params)).status, 503);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.handle(new Request(url), { ...params, candidateId: "../escape" })).status, 400);
  assert.deepEqual(f.calls, []);
});

test("review rejects extra response authority and oversized UTF-8 source", async () => {
  for (const result of [{ ...fixture().view, encodedPilot: "PRIVATE" },
    { ...fixture().view, candidateSource: "😀".repeat(70_000) },
    { ...fixture().view, completedReviews: [] }, { ...fixture().view, fields: [] }]) {
    const f = fixture(); f.state.result = result;
    const response = await f.handle(new Request(url), params);
    assert.equal(response.status, 503); assert.equal(JSON.stringify(await response.json()).includes("PRIVATE"), false);
  }
});

test("bounded source delta is complete for additions, removal, replacement, identical and Unicode text", () => {
  for (const [original, candidate] of [["<div>x</div>", '<div id="x">x</div>'], ["abc", ""], ["", "abc"],
    ["abc", "abc"], ["α😀z", "α😁z"], ["<script>old</script>", "<script>new</script>"]]) {
    const change = describeHtmlLegacySourceChange(original, candidate);
    assert.equal(change.unchangedPrefix + change.removed + change.unchangedSuffix, original);
    assert.equal(change.unchangedPrefix + change.added + change.unchangedSuffix, candidate);
  }
  assert.throws(() => describeHtmlLegacySourceChange("x".repeat(256 * 1024), ""));
  const unicode = describeHtmlLegacySourceChange("α😀z", "α😁z");
  assert.equal(unicode.removed, "😀"); assert.equal(unicode.added, "😁");
});
