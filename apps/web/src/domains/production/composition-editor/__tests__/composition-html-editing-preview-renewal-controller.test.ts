import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlPreviewRenewalController } from "../composition-html-editing-preview-renewal-controller.client";
import type { HtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.contract";

const documentId = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const session = { version: 1 as const, documentHash: "a".repeat(64), nonce: "b".repeat(64), previewGeneration: 3 };
function record(issuedAt: number): HtmlPreviewResourceRenewal {
  return { format: "courseforge-html-preview-resource-renewal-v1", documentId, session,
    bundleSha256: "c".repeat(64), inventoryFingerprint: "d".repeat(64), issuedAt, expiresAt: issuedAt + 180,
    resources: [{ localPath: `conformance-media/${documentId}`,
      url: `${audience}/api/production/hyperframes/drafts/${documentId}/html-preview/resources?cap=body${issuedAt}.signature` }] };
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

test("renewal lifetime advances only after frame apply acknowledgment; no parallel attempts and next cycle is scheduled", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let wall = 100, monotonic = 0, requests = 0, applies = 0;
  let acknowledge!: () => void;
  const gate = new Promise<void>(resolve => { acknowledge = resolve; });
  const failures: string[] = [];
  const controller = createHtmlPreviewRenewalController({ documentId, audience, session, isCurrentOwner: () => true,
    nowSeconds: () => wall, monotonicMilliseconds: () => monotonic, onFailure: reason => failures.push(reason),
    consult: async () => { requests++; return record(wall); }, apply: async () => { applies++; await gate; } });
  try {
    assert.ok(controller.start(record(100))); assert.equal(controller.start(record(100)), false);
    wall = 220; monotonic = 120_000; context.mock.timers.tick(120_000); await settle();
    assert.equal(requests, 1); assert.equal(applies, 1); assert.equal(controller.getState().expiresAt, 280);
    await settle(); assert.equal(requests, 1);
    acknowledge(); await settle(); assert.equal(controller.getState().expiresAt, 400);
    wall = 340; monotonic = 240_000; context.mock.timers.tick(120_000); await settle();
    assert.equal(requests, 2); assert.equal(controller.getState().expiresAt, 520); assert.deepEqual(failures, []);
  } finally { controller.dispose(); context.mock.timers.reset(); }
});

test("hard expiry aborts a stalled application, ignores late acknowledgment and never retries", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let wall = 100, monotonic = 0, requests = 0, release!: () => void, applySignal: AbortSignal | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; }), failures: string[] = [];
  const controller = createHtmlPreviewRenewalController({ documentId, audience, session, isCurrentOwner: () => true,
    nowSeconds: () => wall, monotonicMilliseconds: () => monotonic, onFailure: reason => failures.push(reason),
    consult: async () => { requests++; return record(wall); }, apply: async (_renewal, signal) => { applySignal = signal; await gate; } });
  try {
    controller.start(record(100)); wall = 220; monotonic = 120_000; context.mock.timers.tick(120_000); await settle();
    wall = 280; monotonic = 180_000; context.mock.timers.tick(60_000); await settle();
    assert.ok(applySignal?.aborted); assert.ok(controller.getState().disposed); assert.deepEqual(failures, ["EXPIRED"]);
    release(); await settle(); context.mock.timers.tick(500_000); await settle(); assert.equal(requests, 1);
    assert.equal(controller.getState().expiresAt, null);
  } finally { release(); controller.dispose(); context.mock.timers.reset(); }
});

test("owner drift, revoked reads, changed inventory, omitted resources and replay close without apply or retry", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const scenario of ["owner", "revoked", "inventory", "omitted", "replay", "rollback", "monotonic"]) {
      let wall = 100, monotonic = 0, owner = true, requests = 0, applies = 0;
      const failures: string[] = [];
      const controller = createHtmlPreviewRenewalController({ documentId, audience, session, isCurrentOwner: () => owner,
        nowSeconds: () => wall, monotonicMilliseconds: () => monotonic, onFailure: reason => failures.push(reason),
        consult: async () => { requests++; if (scenario === "revoked") throw new Error("private provider details");
          const renewal = record(scenario === "replay" ? 100 : wall);
          if (scenario === "inventory") renewal.inventoryFingerprint = "e".repeat(64);
          if (scenario === "omitted") renewal.resources = [];
          return renewal; }, apply: async () => { applies++; } });
      controller.start(record(100)); wall = scenario === "rollback" ? 99 : 220;
      monotonic = scenario === "monotonic" ? -1 : 120_000; owner = scenario !== "owner";
      context.mock.timers.tick(120_000); await settle();
      assert.ok(controller.getState().disposed, scenario); assert.equal(applies, 0, scenario); assert.equal(failures.length, 1);
      context.mock.timers.tick(500_000); await settle(); assert.ok(requests <= 1); controller.dispose();
    }
  } finally { context.mock.timers.reset(); }
});

test("external disposal cancels an in-flight consultation and suppresses all late callbacks", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const external = new AbortController(); let wall = 100, monotonic = 0, release!: (renewal: HtmlPreviewResourceRenewal) => void;
  let requestSignal: AbortSignal | undefined, applies = 0, failures = 0;
  const controller = createHtmlPreviewRenewalController({ documentId, audience, session, signal: external.signal,
    isCurrentOwner: () => true, nowSeconds: () => wall, monotonicMilliseconds: () => monotonic,
    consult: async input => { requestSignal = input.signal; return new Promise(resolve => { release = resolve; }); },
    apply: async () => { applies++; }, onFailure: () => failures++ });
  try {
    controller.start(record(100)); wall = 220; monotonic = 120_000; context.mock.timers.tick(120_000); await settle();
    external.abort(); assert.ok(requestSignal?.aborted);
    release(record(220)); await settle(); assert.equal(applies, 0); assert.equal(failures, 0); assert.ok(controller.getState().disposed);
  } finally { controller.dispose(); context.mock.timers.reset(); }
});

test("apply rejection and throwing owner guard terminate the lifetime with one safe failure", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const scenario of ["apply", "guard"]) {
      let wall = 100, monotonic = 0, guardThrows = false, calls = 0;
      const failures: string[] = [];
      const controller = createHtmlPreviewRenewalController({ documentId, audience, session,
        isCurrentOwner: () => { if (guardThrows) throw new Error("private owner details"); return true; },
        nowSeconds: () => wall, monotonicMilliseconds: () => monotonic,
        onFailure: reason => failures.push(reason), consult: async () => { calls++; return record(220); },
        apply: async () => { throw new Error("private port failure"); } });
      controller.start(record(100)); guardThrows = scenario === "guard"; wall = 220; monotonic = 120_000;
      context.mock.timers.tick(120_000); await settle();
      assert.deepEqual(failures, ["UNAVAILABLE"]); assert.ok(controller.getState().disposed);
      assert.equal(calls, scenario === "guard" ? 0 : 1); controller.dispose();
    }
  } finally { context.mock.timers.reset(); }
});

test("pre-aborted, already expired and malformed initial sessions never consult or apply", () => {
  for (const scenario of ["aborted", "expired", "malformed"]) {
    const abort = new AbortController(); if (scenario === "aborted") abort.abort();
    let calls = 0, failures = 0;
    const controller = createHtmlPreviewRenewalController({ documentId, audience, session, signal: abort.signal,
      isCurrentOwner: () => true, nowSeconds: () => scenario === "expired" ? 280 : 100, monotonicMilliseconds: () => 0,
      consult: async () => { calls++; return record(220); }, apply: async () => { calls++; }, onFailure: () => failures++ });
    const initial = record(100); if (scenario === "malformed") initial.session = { ...session, nonce: "e".repeat(64) };
    assert.equal(controller.start(initial), false); assert.ok(controller.getState().disposed); assert.equal(calls, 0);
    assert.equal(failures, scenario === "aborted" ? 0 : 1); controller.dispose();
  }
});
