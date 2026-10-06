import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingMutationService } from "../composition-html-editing-mutation.server";
import { SupabaseHtmlEditingRevisionRepository } from "../composition-html-editing-repository.service";
import { createHtmlEditingMutationHandler } from "../http/composition-html-editing-mutation-handler.server";
import { htmlEditingMutationRequestSchema, htmlEditingMutationEnabled, type HtmlEditingMutationInput } from "../composition-html-editing-mutation.contract";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { createHtmlEditingRevisionFixture as fixture, htmlEditingFixtureId as uuid,
  htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function host() {
  const input = fixture();
  const state = { encoded: JSON.stringify(input.current.revision), sha256: input.current.sha256,
    grants: [uuid, other], writes: 0, reads: 0, historyReads: 0, loseAck: false };
  const repository = {
    readAuthorized: async () => { state.reads++; return { ...input.authority, grantedAssetIds: state.grants,
      encodedRevision: state.encoded, compositionDocumentHash: input.row.compositionDocumentHash }; },
    readRestoreRevision: async (request: { restore: { version: number; sha256: string } }) => {
      state.historyReads++; assert.deepEqual(request.restore, { version: 1, sha256: input.current.sha256 }); return JSON.stringify(input.current.revision);
    },
    appendCompareAndSwap: async (request: { expected: { sha256: string }; revision: typeof input.current.revision; sha256: string }) => {
      state.writes++; if (state.sha256 !== request.expected.sha256) return { status: "CONFLICT" as const };
      state.encoded = JSON.stringify(request.revision); state.sha256 = request.sha256;
      if (state.loseAck) throw new Error("PRIVATE_ACK_FAILURE");
      return { status: "COMMITTED" as const, version: request.revision.version, sha256: request.sha256 };
    },
  };
  const request: HtmlEditingMutationInput = { action: "COMMAND", actorId: uuid, organizationId: uuid, documentId: uuid,
    clipId: input.request.scope.clipId, expected: { version: 1, sha256: input.current.sha256 },
    expectedCompositionDocumentHash: input.row.compositionDocumentHash,
    overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }] };
  return { input, state, request, mutate: createHtmlEditingMutationService(repository) };
}
test("command obtains binding from server and historical restoration appends forward without client HTML", async () => {
  const f = host(); const applied = await f.mutate(f.request);
  assert.equal(applied.changed, true); assert.equal(applied.next.version, 2);
  const restored = await f.mutate({ ...f.request, action: "RESTORE", expected: applied.next,
    restore: { version: 1, sha256: f.input.current.sha256 } });
  assert.equal(restored.next.version, 3); assert.equal(f.state.historyReads, 1); assert.equal(f.state.writes, 2);
  assert.deepEqual(JSON.parse(f.state.encoded).state.overrides, []);
});
test("no-op has no write and stale CAS is rejected before persistence", async () => {
  const f = host();
  const result = await f.mutate({ ...f.request, action: "COMMAND", overrides: [{ operation: "RESET", elementId: "title", property: "TEXT" }] });
  assert.equal(result.changed, false); assert.deepEqual(result.next, f.request.expected); assert.equal(f.state.writes, 0);
  await assert.rejects(f.mutate({ ...f.request, expected: { version: 2, sha256: "f".repeat(64) } }), /REVISION_CONFLICT/);
  assert.equal(f.state.writes, 0);
});
test("revoked resources and lost write ACK cannot become successful operations or retries", async () => {
  const f = host(); f.state.grants = [other];
  await assert.rejects(f.mutate(f.request), /INVALID_SOURCE/); assert.equal(f.state.writes, 0);
  const uncertain = host(); uncertain.state.loseAck = true;
  await assert.rejects(uncertain.mutate(uncertain.request), /COMMIT_UNCONFIRMED/); assert.equal(uncertain.state.writes, 1);
});
test("restoration cannot resurrect a revoked original image even when the current replacement is authorized", async () => {
  const f = host();
  const replacement = await f.mutate({ ...f.request, action: "COMMAND",
    overrides: [{ operation: "SET_IMAGE", elementId: "photo", assetId: other, fit: "COVER" }] });
  f.state.grants = [other];
  await assert.rejects(f.mutate({ action: "RESTORE", actorId: uuid, organizationId: uuid, documentId: uuid,
    clipId: f.request.clipId, expected: replacement.next, expectedCompositionDocumentHash: f.request.expectedCompositionDocumentHash,
    restore: { version: 1, sha256: f.input.current.sha256 } }), /INVALID_SOURCE/);
  assert.equal(f.state.historyReads, 1); assert.equal(f.state.writes, 1);
});
test("mutation contract forbids source, grants, bindings and client-serialized restore snapshots", () => {
  const f = host(); const { actorId: _actor, organizationId: _org, documentId: _doc, clipId: _clip, ...body } = f.request;
  assert.equal(htmlEditingMutationRequestSchema.safeParse(body).success, true);
  for (const extra of [{ sourceHtml: "unsafe" }, { grants: [uuid] }, { binding: f.input.authority.authoritativeBinding },
    { encodedRestoreRevision: JSON.stringify(f.input.current.revision) }]) assert.equal(htmlEditingMutationRequestSchema.safeParse({ ...body, ...extra }).success, false);
});
test("historical repository reader validates exact locator, scope and independently computed content digest", async () => {
  const f = host(); let calls = 0;
  let payload: unknown = { revision: f.input.current.revision, revisionSha256: f.input.current.sha256 };
  const repository = new SupabaseHtmlEditingRevisionRepository({ rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    calls++; assert.equal(name, "read_html_editing_restore_revision"); assert.equal(args.p_actor_id, uuid);
    assert.equal(args.p_restore_sha256, f.input.current.sha256); return { data: payload, error: null };
  } }) } as unknown as SupabaseClient);
  const request = { ...f.input.request, restore: { version: 1, sha256: f.input.current.sha256 } };
  assert.deepEqual(JSON.parse(await repository.readRestoreRevision(request)), f.input.current.revision);
  const altered = structuredClone(f.input.current.revision); altered.state.overrides = [{ operation: "SET_TEXT", elementId: "title", value: "Substitution" }];
  payload = { revision: altered, revisionSha256: f.input.current.sha256 };
  await assert.rejects(repository.readRestoreRevision(request), /INVALID_REVISION/); assert.equal(calls, 2);
});

function httpHost() {
  const f = host(), { actorId: _actor, organizationId: _org, documentId: _doc, clipId: _clip, ...body } = f.request;
  const calls: string[] = [];
  const state = { enabled: true, actorId: uuid as string | null, role: "ADMIN", allowed: true, failure: null as Error | null,
    result: { scope: "EDITORIAL_RESULT_NOT_CURRENT_STATE_OR_RENDERED", changed: true, previous: body.expected,
      next: { version: 2, sha256: "b".repeat(64) } } as unknown };
  const handler = createHtmlEditingMutationHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push("auth"); return { actorId: state.actorId, tenant: { organizationId: uuid, userId: uuid, platformRole: state.role } }; },
    serviceClient: () => { calls.push("client"); return { rpc: () => ({ abortSignal: async () => {
      calls.push("quota"); return { data: [{ allowed: state.allowed, reset_at: "2026-10-06T23:00:00Z" }], error: null };
    } }) } as never; },
    mutate: async (_client, input) => { calls.push("mutate"); assert.equal(input.actorId, uuid); assert.equal(input.organizationId, uuid);
      if (state.failure) throw state.failure; return state.result; },
  });
  const request = (value: unknown = body, headers: Record<string, string> = {}) => new Request("https://app.example/api/editorial", {
    method: "POST", headers: { origin: "https://app.example", "content-type": "application/json", ...headers }, body: JSON.stringify(value),
  });
  return { handler, request, state, calls, body, params: { draftId: uuid, clipId: f.request.clipId } };
}
test("disabled mutation gate is literal true only and performs no work", async () => {
  for (const value of [undefined, "TRUE", "1", "false", ""]) assert.equal(htmlEditingMutationEnabled(value), false);
  assert.equal(htmlEditingMutationEnabled("true"), true);
  const f = httpHost(); f.state.enabled = false; assert.equal((await f.handler(f.request(), f.params)).status, 503); assert.deepEqual(f.calls, []);
});
test("HTTP rejects origin, roles, anonymous callers and authority extras before any mutation", async () => {
  for (const mode of ["origin", "role", "anonymous", "body", "quota"]) {
    const f = httpHost(); if (mode === "role") f.state.role = "BUILDER"; if (mode === "anonymous") f.state.actorId = null;
    if (mode === "quota") f.state.allowed = false;
    const response = await f.handler(f.request(mode === "body" ? { ...f.body, sourceHtml: "unsafe" } : f.body,
      mode === "origin" ? { origin: "https://evil.example" } : {}), f.params);
    assert.equal(response.status, mode === "anonymous" ? 401 : mode === "body" ? 400 : mode === "quota" ? 429 : 403);
    assert.ok(!f.calls.includes("mutate"));
  }
});
test("HTTP confirms exact editorial CAS metadata but rejects wrong ACK and reports uncertainty safely", async () => {
  const success = httpHost(), response = await success.handler(success.request(), success.params);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json(); assert.equal(result.requestId, result.correlationId);
  for (const mode of ["conflict", "uncertain", "badAck"]) {
    const f = httpHost(); if (mode === "badAck") f.state.result = {};
    else f.state.failure = new HtmlEditingRevisionError(mode === "conflict" ? "REVISION_CONFLICT" : "COMMIT_UNCONFIRMED");
    const failed = await f.handler(f.request(), f.params); assert.equal(failed.status, mode === "conflict" ? 409 : 503);
    assert.match(await failed.text(), /"retryable":false/); assert.equal(f.calls.filter(call => call === "mutate").length, 1);
  }
});
