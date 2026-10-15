import assert from "node:assert/strict";
import test from "node:test";
import { createCompositionAgentReadSession, COMPOSITION_AGENT_SESSION_LIMITS } from "../composition-agent-read-session.service";
import { compositionAgentReadBytes, CompositionAgentReadError } from "../composition-agent-read-tools.service";
import { COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES } from "../composition-agent-policy.service";
import { hashCompositionDocument } from "../composition-document-hash";
import { AGENT_TEST_NOW, compositionAgentFixture } from "./composition-agent-test-fixture";

const catalog = { tool: "get_operation_catalog", arguments: {} };
const clips = { tool: "get_composition", arguments: { section: "clips", limit: 1 } };
const errorCode = (code: string) => (error: unknown) => error instanceof CompositionAgentReadError && error.code === code;

test("catalog derives only authorized operations from the unchanged allow-list", () => {
  const fixture = compositionAgentFixture();
  const session = createCompositionAgentReadSession(fixture);
  assert.deepEqual(session.read(catalog).result, { operationTypes: [...COMPOSITION_AGENT_ALLOWED_OPERATION_TYPES], maxOperations: 12, requiresConfirmation: true, automaticApply: false });
  fixture.authorization.operationTypes = ["clip.layout"];
  assert.deepEqual((createCompositionAgentReadSession(fixture).read(catalog).result as { operationTypes: string[] }).operationTypes, ["clip.layout"]);
});

test("paged safe projection and fixed selection expose no asset/source internals", () => {
  const fixture = compositionAgentFixture(2);
  const session = createCompositionAgentReadSession({ ...fixture, selectedClipIds: [fixture.clip.id] });
  const first = session.read(clips).result as { items: { id: string }[]; total: number; nextOffset: number };
  assert.equal(first.items.length, 1);
  assert.equal(first.total, fixture.document.clips.length);
  assert.equal(first.nextOffset, 1);
  const second = session.read({ ...clips, arguments: { section: "clips", offset: 1, limit: 1 } }).result as { items: { id: string }[] };
  assert.notEqual(second.items[0]?.id, first.items[0]?.id);
  const selected = session.read({ tool: "get_selected_elements", arguments: {} });
  assert.deepEqual((selected.result as { items: { id: string }[] }).items.map((clip) => clip.id), [fixture.clip.id]);
  assert.doesNotMatch(JSON.stringify([first, second, selected]), /storagePath|publicUrl|productionAssetId|source/);
});

test("host and caller mutations cannot change an admitted session or its permissions", () => {
  const fixture = compositionAgentFixture();
  fixture.authorization.tools = ["get_composition"];
  const session = createCompositionAgentReadSession(fixture);
  const before = session.read(clips);
  fixture.clip.layout.x = 99;
  fixture.authorization.tools.push("get_operation_catalog");
  assert.deepEqual(session.read(clips), before);
  assert.throws(() => session.read(catalog), errorCode("AGENT_READ_FORBIDDEN"));
  assert.ok(Object.isFrozen(before));
  assert.ok(Object.isFrozen((before.result as { items: unknown[] }).items[0]));
});

test("rejects mismatched user, tenant and document before any read", () => {
  for (const key of ["userId", "organizationId", "documentId"] as const) {
    const fixture = compositionAgentFixture();
    fixture.authorization.scope[key] = "00000000-0000-4000-8000-000000000088";
    assert.throws(() => createCompositionAgentReadSession(fixture), errorCode("AGENT_READ_FORBIDDEN"));
  }
});

test("rejects stale revision, hash and a document that does not reproduce authorized hash", () => {
  const fixture = compositionAgentFixture();
  assert.throws(() => createCompositionAgentReadSession({ ...fixture, scope: { ...fixture.scope, revision: 8 } }), errorCode("AGENT_READ_STALE"));
  assert.throws(() => createCompositionAgentReadSession({ ...fixture, scope: { ...fixture.scope, documentHash: "a".repeat(64) } }), errorCode("AGENT_READ_STALE"));
  fixture.clip.layout.x += 1;
  assert.throws(() => createCompositionAgentReadSession(fixture), errorCode("AGENT_READ_STALE"));
});

test("expiry is checked on admission and every call at the exact boundary", () => {
  const fixture = compositionAgentFixture();
  fixture.authorization.expiresAtMs = AGENT_TEST_NOW;
  assert.throws(() => createCompositionAgentReadSession(fixture), errorCode("AGENT_READ_EXPIRED"));
  fixture.authorization.expiresAtMs += 1;
  let now = AGENT_TEST_NOW;
  const session = createCompositionAgentReadSession({ ...fixture, now: () => now });
  session.read(catalog);
  now += 1;
  assert.throws(() => session.read(catalog), errorCode("AGENT_READ_EXPIRED"));
});

test("unknown tools, malformed paging and attempts to inject grants or budget are rejected", () => {
  const session = createCompositionAgentReadSession(compositionAgentFixture());
  for (const request of [null, { tool: "render.request", arguments: {} }, { ...clips, arguments: { section: "clips", limit: 51 } }, { ...clips, arguments: { section: "clips", offset: -1 } }, { ...catalog, authorization: {} }, { ...catalog, budget: { maxCalls: 999 } }, { tool: "get_selected_elements", arguments: { clipIds: ["invented"] } }]) {
    assert.throws(() => session.read(request));
  }
  assert.equal(session.usage().calls, 7);
  assert.equal(session.usage().responseBytes, 0);
});

test("forbidden and malformed attempts cannot bypass the cumulative call budget", () => {
  const fixture = compositionAgentFixture();
  fixture.authorization.tools = [];
  const session = createCompositionAgentReadSession({ ...fixture, budget: { maxCalls: 2 } });
  assert.throws(() => session.read(catalog), errorCode("AGENT_READ_FORBIDDEN"));
  assert.throws(() => session.read(null));
  assert.throws(() => session.read(catalog), errorCode("AGENT_READ_LIMIT_EXCEEDED"));
});

test("UTF-8 response and total byte limits fail without emitting partial results", () => {
  const fixture = compositionAgentFixture();
  fixture.document.clips[0]!.label = "🎬".repeat(20);
  // Rebuild scope for this edited, host-authorized document.
  fixture.scope.documentHash = hashCompositionDocument(fixture.document);
  fixture.authorization.scope.documentHash = fixture.scope.documentHash;
  const response = createCompositionAgentReadSession(fixture).read(clips);
  const bytes = compositionAgentReadBytes(response);
  assert.ok(bytes > JSON.stringify(response).length);
  const session = createCompositionAgentReadSession({ ...fixture, budget: { maxResponseBytes: bytes, maxTotalBytes: 2 * bytes } });
  session.read(clips);
  session.read(clips);
  assert.throws(() => session.read(clips), errorCode("AGENT_READ_LIMIT_EXCEEDED"));
  assert.equal(session.usage().responseBytes, 2 * bytes);
  const small = createCompositionAgentReadSession({ ...fixture, budget: { maxResponseBytes: bytes - 1 } });
  assert.throws(() => small.read(clips), errorCode("AGENT_READ_LIMIT_EXCEEDED"));
  assert.equal(small.usage().responseBytes, 0);
});

test("work limits and budget increases above hard ceilings are rejected", () => {
  const fixture = compositionAgentFixture();
  assert.throws(() => createCompositionAgentReadSession({ ...fixture, budget: { maxCalls: COMPOSITION_AGENT_SESSION_LIMITS.maxCalls + 1 } }));
  const session = createCompositionAgentReadSession({ ...fixture, budget: { maxWorkUnits: 1 } });
  assert.throws(() => session.read(catalog), errorCode("AGENT_READ_LIMIT_EXCEEDED"));
  assert.equal(session.usage().responseBytes, 0);
  const largeRequest = createCompositionAgentReadSession(fixture);
  assert.throws(() => largeRequest.read({ ...catalog, extra: "x".repeat(COMPOSITION_AGENT_SESSION_LIMITS.maxRequestBytes) }), errorCode("AGENT_READ_LIMIT_EXCEEDED"));
  assert.equal(largeRequest.usage().calls, 1);
  assert.equal(largeRequest.usage().responseBytes, 0);
});

test("conflict tool is paged, charges scan/comparisons and respects its own permission", () => {
  const fixture = compositionAgentFixture(2);
  const second = fixture.document.clips.filter((clip) => clip.kind === "VIDEO")[1]!;
  second.startSeconds = 1;
  fixture.scope.documentHash = hashCompositionDocument(fixture.document);
  fixture.authorization.scope.documentHash = fixture.scope.documentHash;
  const session = createCompositionAgentReadSession(fixture);
  const conflicts = session.read({ tool: "get_timeline_conflicts", arguments: { limit: 1 } }).result as { items: { clipIds: string[]; overlapSeconds: number }[]; total: number };
  assert.deepEqual(conflicts.items[0]?.clipIds, [fixture.clip.id, second.id]);
  assert.equal(conflicts.items[0]?.overlapSeconds, 3);
  assert.equal(conflicts.total, 1);
  assert.ok(session.usage().workUnits > fixture.document.clips.length * fixture.document.tracks.length);
  fixture.authorization.tools = ["get_motion_catalog"];
  assert.throws(() => createCompositionAgentReadSession(fixture).read({ tool: "get_timeline_conflicts", arguments: {} }), errorCode("AGENT_READ_FORBIDDEN"));
});

test("unknown/duplicate authorized selection and malformed grants fail closed", () => {
  const fixture = compositionAgentFixture();
  for (const selectedClipIds of [["unknown"], [fixture.clip.id, fixture.clip.id]]) {
    assert.throws(() => createCompositionAgentReadSession({ ...fixture, selectedClipIds }), errorCode("AGENT_READ_FORBIDDEN"));
  }
  assert.throws(() => createCompositionAgentReadSession({ ...fixture, authorization: { ...fixture.authorization, expiresAtMs: NaN } }));
  assert.throws(() => createCompositionAgentReadSession({ ...fixture, authorization: { ...fixture.authorization, operationTypes: ["clip.remove"] } as never }));
});
