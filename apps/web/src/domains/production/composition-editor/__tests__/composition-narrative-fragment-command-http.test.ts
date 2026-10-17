import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeFragmentCommandHttpHandler, type NarrativeFragmentCommandHttpDependencies } from "../http/composition-narrative-fragment-command-handler.server";
import { fingerprintNarrativeFragmentRequest } from "../composition-narrative-fragment-apply.server";
import type { NarrativeFragmentApplyRequest } from "../composition-narrative-fragment-command-contract";
import { narrativeFragmentApplyEnabled, narrativeFragmentPersistenceReady, narrativeFragmentOrganizationEnabled } from "../http/composition-narrative-fragment-rollout.server";

const draftId = "55555555-5555-4555-8555-555555555555";
const organizationId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";
const commandId = "66666666-6666-4666-8666-666666666666";
const command: NarrativeFragmentApplyRequest = { contract: "NARRATIVE_FRAGMENT_APPLY_V1", commandId, reviewFingerprint: "a".repeat(64),
  query: { contract: "NARRATIVE_FRAGMENT_QUERY_V1", selectedTrackIds: ["voice", "text"],
    selection: { documentHash: "b".repeat(64), occurrenceId: "occurrence", firstSourceIndex: 1, lastSourceIndex: 2 } } };
const receipt = { contract: "NARRATIVE_FRAGMENT_RECEIPT_V1", commandId, requestFingerprint: fingerprintNarrativeFragmentRequest(command),
  documentHash: "c".repeat(64), version: 2, anchorClipId: `voice-extract-${commandId}`,
  newClipIds: [`voice-extract-${commandId}`, `fragment-${commandId}-0`] };
function setup() {
  let serviceLoads = 0;
  let receiptReads = 0;
  const dependencies: NarrativeFragmentCommandHttpDependencies = {
    enabled: () => true, configuredAppUrl: () => "https://editor.example",
    authorize: async () => ({ status: "AUTHORIZED", organizationId, userId }),
    consumeRateLimit: async () => ({ status: "ALLOWED" }), logFailure: () => undefined,
    loadServices: async scope => {
      serviceLoads++; assert.deepEqual(scope, { organizationId, userId, draftId });
      return { reads: { readComponentId: async () => { throw Error("unexpected source read"); },
        readDocument: async () => { throw Error("unexpected document read"); },
        readAssets: async () => { throw Error("unexpected asset read"); }, readFonts: async () => [] },
        commands: { readReceipt: async scope => {
          receiptReads++; assert.deepEqual(scope, { organizationId, userId, draftId, commandId }); return receipt;
        }, commit: async () => { throw Error("unexpected append"); } } };
    },
  };
  return { dependencies, counts: () => ({ serviceLoads, receiptReads }) };
}
function request(body: unknown = command, headers: Record<string, string> = {}) {
  return new Request(`https://editor.example/api/drafts/${draftId}`, { method: "POST",
    headers: { Origin: "https://editor.example", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("audiovisual replay and recovery expose all clip identities without current source reads or append", async () => {
  for (const mode of ["APPLY", "RECOVERY"] as const) {
    const current = setup();
    const response = await createNarrativeFragmentCommandHttpHandler(mode, current.dependencies)(request(), draftId);
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.data.status, mode === "APPLY" ? "REPLAYED" : "CONFIRMED");
    assert.deepEqual(body.data.newClipIds, receipt.newClipIds); assert.equal(body.data.reloadDocumentRequired, true);
    assert.ok(!JSON.stringify(body).includes("requestFingerprint"));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(current.counts(), { serviceLoads: 1, receiptReads: 1 });
  }
});
test("closed gate, foreign origin, malformed command and invalid route never load services", async () => {
  for (const kind of ["gate", "origin", "body", "route"] as const) {
    const current = setup(); if (kind === "gate") current.dependencies.enabled = () => false;
    const response = await createNarrativeFragmentCommandHttpHandler("APPLY", current.dependencies)(
      request(kind === "body" ? { ...command, operations: [] } : command, kind === "origin" ? { Origin: "https://foreign.example" } : {}),
      kind === "route" ? "invalid" : draftId);
    assert.equal(response.status, kind === "gate" ? 503 : kind === "origin" ? 403 : 400);
    assert.equal((await response.json()).details.requestNotApplied, true);
    assert.deepEqual(current.counts(), { serviceLoads: 0, receiptReads: 0 });
  }
});
test("current authorization and shared rate limiter fail closed before repository access", async () => {
  for (const kind of ["auth", "tenant", "role", "limited", "unavailable"] as const) {
    const current = setup();
    if (kind === "auth" || kind === "tenant" || kind === "role") current.dependencies.authorize = async () => ({
      status: kind === "auth" ? "AUTH_REQUIRED" : kind === "tenant" ? "TENANT_FORBIDDEN" : "ROLE_FORBIDDEN",
    });
    else current.dependencies.consumeRateLimit = async (_scope, purpose) => {
      assert.equal(purpose, "RECOVERY");
      return kind === "limited" ? { status: "LIMITED", retryAfterSeconds: 999 } : { status: "UNAVAILABLE" };
    };
    const response = await createNarrativeFragmentCommandHttpHandler("RECOVERY", current.dependencies)(request(), draftId);
    assert.equal(response.status, kind === "auth" ? 401 : kind === "limited" ? 429 : kind === "unavailable" ? 503 : 403);
    assert.equal((await response.json()).details.requestNotApplied, false);
    if (kind === "limited") assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(current.counts().serviceLoads, 0);
  }
});
test("missing receipt returns uncertain 202 and recovery never dispatches commit", async () => {
  const current = setup(); const load = current.dependencies.loadServices;
  current.dependencies.loadServices = async (scope, signal) => {
    const services = await load(scope, signal); assert.ok(services); services.commands.readReceipt = async () => null; return services;
  };
  const response = await createNarrativeFragmentCommandHttpHandler("RECOVERY", current.dependencies)(request(), draftId);
  assert.equal(response.status, 202); const body = await response.json();
  assert.equal(body.data.status, "UNCONFIRMED"); assert.equal(body.data.recoveryRequired, true);
  assert.equal(body.data.automaticRetryAllowed, false); assert.ok(!("newClipIds" in body.data));
});
test("reused and corrupt receipts cannot claim that the command was never applied", async () => {
  for (const kind of ["reused", "corrupt", "unavailable"] as const) {
    const current = setup(); const load = current.dependencies.loadServices;
    current.dependencies.loadServices = async (scope, signal) => {
      const services = await load(scope, signal); assert.ok(services);
      services.commands.readReceipt = async () => {
        if (kind === "unavailable") throw Error("private database detail");
        return kind === "reused" ? { ...receipt, requestFingerprint: "f".repeat(64) } : { ...receipt, newClipIds: [] };
      }; return services;
    };
    const response = await createNarrativeFragmentCommandHttpHandler("APPLY", current.dependencies)(request(), draftId);
    assert.equal(response.status, kind === "reused" ? 409 : 503);
    const body = await response.json(); assert.equal(body.details.requestNotApplied, false);
    assert.ok(!JSON.stringify(body).includes("private database detail"));
  }
});
test("audiovisual rollout is independent, strict and disabled by default", () => {
  const names = ["NARRATIVE_FRAGMENT_ATOMIC_RECEIPTS_READY", "NARRATIVE_FRAGMENT_ENABLED", "NARRATIVE_FRAGMENT_ORGANIZATION_IDS"];
  const prior = names.map(name => process.env[name]);
  try {
    names.forEach(name => delete process.env[name]);
    assert.equal(narrativeFragmentPersistenceReady(), false); assert.equal(narrativeFragmentApplyEnabled(), false);
    assert.equal(narrativeFragmentOrganizationEnabled(organizationId), false);
    process.env.NARRATIVE_FRAGMENT_ENABLED = "true"; assert.equal(narrativeFragmentApplyEnabled(), false);
    process.env.NARRATIVE_FRAGMENT_ATOMIC_RECEIPTS_READY = "true"; assert.equal(narrativeFragmentApplyEnabled(), true);
    process.env.NARRATIVE_FRAGMENT_ORGANIZATION_IDS = organizationId; assert.equal(narrativeFragmentOrganizationEnabled(organizationId), true);
    process.env.NARRATIVE_FRAGMENT_ORGANIZATION_IDS = organizationId + ",invalid"; assert.equal(narrativeFragmentOrganizationEnabled(organizationId), false);
    process.env.NARRATIVE_FRAGMENT_ENABLED = "false"; assert.equal(narrativeFragmentPersistenceReady(), true);
    assert.equal(narrativeFragmentApplyEnabled(), false);
  } finally {
    names.forEach((name, index) => { if (prior[index] === undefined) delete process.env[name]; else process.env[name] = prior[index]; });
  }
});
