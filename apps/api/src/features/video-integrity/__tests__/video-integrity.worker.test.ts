import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyVideoIntegrityFailure, processVideoIntegrityJob } from "../video-integrity.worker";
import type { verifyImportedHyperframesVideo } from "../video-integrity.service";

const identifier = "12345678-1234-4234-8234-123456789abc";
const claim = { id: identifier, organization_id: identifier, request_id: identifier, lease_token: identifier, attempts: 1 };
const verified = { assetId: identifier, checksum: "a".repeat(64), documentHash: "b".repeat(64), sizeBytes: 100 };
type Verify = typeof verifyImportedHyperframesVideo;

function database(options: { claims?: unknown; claimError?: unknown; finishError?: unknown; accepted?: boolean } = {}) {
  const calls: Array<{ name: string; parameters?: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (name: string, parameters?: Record<string, unknown>) => {
      calls.push({ name, parameters });
      if (name === "claim_hyperframes_video_integrity_job") return { data: options.claims ?? [claim], error: options.claimError ?? null };
      assert.equal(name, "finish_hyperframes_video_integrity_job");
      return { data: options.accepted ?? true, error: options.finishError ?? null };
    },
  } as unknown as SupabaseClient<any, any, any>;
  return { calls, supabase };
}

test("idle worker does not verify or finish", async () => {
  const fixture = database({ claims: [] });
  const result = await processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async () => assert.fail("not called"));
  assert.equal(result.status, "IDLE"); assert.equal(fixture.calls.length, 1);
});

test("claimed job verifies exact tenant/request and finishes with the owning lease", async () => {
  const fixture = database();
  const result = await processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async (input) => {
    assert.equal(input.organizationId, claim.organization_id); assert.equal(input.requestId, claim.request_id);
    assert.equal(input.supabase, fixture.supabase); return verified;
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(fixture.calls[1]?.parameters, {
    p_job_id: claim.id, p_lease_token: claim.lease_token, p_result: verified, p_error_code: null, p_retryable: false,
  });
});

test("transient failure is sanitized and retryable, lineage/security failure is terminal", async () => {
  for (const [error, code, retryable] of [
    [new Error("credential=secret https://internal.invalid"), "VIDEO_INTEGRITY_WORKER_FAILED", true],
    [new Error("VIDEO_INTEGRITY_TRUNCATED_BODY"), "VIDEO_INTEGRITY_TRUNCATED_BODY", true],
    [new Error("VIDEO_INTEGRITY_OVERWRITTEN"), "VIDEO_INTEGRITY_OVERWRITTEN", false],
    [new Error("VIDEO_INTEGRITY_LINEAGE_MISMATCH"), "VIDEO_INTEGRITY_LINEAGE_MISMATCH", false],
    [new Error("VIDEO_INTEGRITY_SIGNED_URL_INVALID"), "VIDEO_INTEGRITY_SIGNED_URL_INVALID", false],
  ] as const) {
    const fixture = database();
    const result = await processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async () => { throw error; });
    assert.equal(result.status, "FAILED_ATTEMPT"); assert.equal(result.errorCode, code);
    assert.equal(fixture.calls[1]?.parameters?.p_retryable, retryable);
    assert.equal(fixture.calls[1]?.parameters?.p_result, null);
    assert.ok(!JSON.stringify(fixture.calls).includes("secret"));
  }
});

test("stale lease cannot declare success", async () => {
  const fixture = database({ accepted: false });
  const result = await processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async () => verified);
  assert.equal(result.status, "LEASE_LOST");
});

test("lost finish acknowledgement never causes a second finish rewriting success as failure", async () => {
  const fixture = database({ finishError: new Error("private backend detail") });
  await assert.rejects(processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async () => verified), /VIDEO_INTEGRITY_FINISH_FAILED/);
  assert.equal(fixture.calls.length, 2);
});

test("malformed claims, excessive batches and claim failures fail before verification", async () => {
  for (const claims of [[{ ...claim, attempts: 6 }], [claim, claim], [{ ...claim, organization_id: "invalid" }]]) {
    const fixture = database({ claims });
    await assert.rejects(processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async () => assert.fail("not called")));
    assert.equal(fixture.calls.length, 1);
  }
  const fixture = database({ claimError: new Error("secret") });
  await assert.rejects(processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", async () => verified), /VIDEO_INTEGRITY_CLAIM_FAILED/);
});

test("invalid verifier output is rejected without persisting raw fields", async () => {
  const fixture = database();
  const invalidVerify = (async () => ({ ...verified, signedUrl: "secret" })) as Verify;
  await processVideoIntegrityJob(fixture.supabase, "https://example.supabase.co", invalidVerify);
  assert.equal(fixture.calls[1]?.parameters?.p_result, null);
  assert.equal(fixture.calls[1]?.parameters?.p_error_code, "VIDEO_INTEGRITY_WORKER_FAILED");
});

test("failure classifier never includes arbitrary exception content", () => {
  assert.deepEqual(classifyVideoIntegrityFailure({ message: "private" }), { code: "VIDEO_INTEGRITY_WORKER_FAILED", retryable: true });
});
