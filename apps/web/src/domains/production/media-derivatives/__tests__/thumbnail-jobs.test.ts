import assert from "node:assert/strict";
import test from "node:test";
import { cancelThumbnailJob, processClaimedThumbnailJob, requestThumbnailJob, thumbnailJobIdempotencyKey,
  type ThumbnailClaim, type ThumbnailProductionJobsPort } from "../thumbnail-jobs.adapter.server";
import { rejectThumbnail, requireThumbnailActive } from "../thumbnail-runtime.contract";
import { access, harness, identity, otherTenant, signal, spriteFixture, stream } from "./thumbnail-fixtures";

const claim: ThumbnailClaim = { jobId: "66666666-6666-4666-8666-666666666666",
  leaseToken: "77777777-7777-4777-8777-777777777777", attempt: 1, access, identity };

function jobsHarness() {
  const h = harness();
  let status: "RUNNING" | "CANCELLED" | "LEASE_LOST" = "RUNNING";
  const calls = { complete: 0, fail: 0, enqueued: 0, heartbeat: 0 };
  const keys = new Set<string>();
  const jobs: ThumbnailProductionJobsPort = {
    createOrReuse: async (request) => {
      if (!keys.has(request.idempotencyKey)) { keys.add(request.idempotencyKey); calls.enqueued++; }
      return { jobId: claim.jobId, organizationId: request.access.organizationId, idempotencyKey: request.idempotencyKey };
    },
    heartbeat: async () => { calls.heartbeat++; return status; },
    storeForClaim: () => ({ ...h.store, putCreateOnly: async (record, bytes, active) => {
      requireThumbnailActive(active);
      if (status !== "RUNNING") rejectThumbnail("THUMBNAIL_LEASE_LOST");
      await h.store.putCreateOnly(record, bytes, active);
    } }),
    complete: async () => { calls.complete++; return status === "RUNNING"; },
    fail: async () => { calls.fail++; return status === "RUNNING"; },
    cancel: async () => { status = "CANCELLED"; return true; },
  };
  const params = { claim, authority: h.authority, runtime: h.runtime, jobs, signal: signal(), now: () => 1_000, heartbeatIntervalMs: 10 };
  return { h, jobs, params, calls, setStatus: (next: typeof status) => { status = next; } };
}

test("request adapter is authorized, concurrent requests reuse component/source identity and no actor-specific key", async () => {
  const j = jobsHarness(); const params = { access, identity, authority: j.h.authority, jobs: j.jobs, signal: signal() };
  const result = await Promise.all([requestThumbnailJob(params), requestThumbnailJob(params)]);
  assert.equal(result[0].jobId, result[1].jobId); assert.equal(j.calls.enqueued, 1);
  const key = thumbnailJobIdempotencyKey(access, identity);
  assert.equal(thumbnailJobIdempotencyKey({ ...access, actorId: otherTenant }, identity), key);
  assert.notEqual(thumbnailJobIdempotencyKey({ ...access, componentId: otherTenant }, identity), key);
  assert.notEqual(thumbnailJobIdempotencyKey({ ...access, sourceAssetId: otherTenant }, identity), key);
});

test("request/cancel reject cross-tenant calls before common job infrastructure", async () => {
  const j = jobsHarness(); const params = { access: { ...access, organizationId: otherTenant }, identity,
    authority: j.h.authority, jobs: j.jobs, signal: signal() };
  await assert.rejects(requestThumbnailJob(params), /THUMBNAIL_ACCESS_DENIED/);
  await assert.rejects(cancelThumbnailJob(params), /THUMBNAIL_ACCESS_DENIED/);
  assert.equal(j.calls.enqueued, 0);
  const crossClaim = { ...claim, access: params.access };
  await assert.rejects(processClaimedThumbnailJob({ ...j.params, claim: crossClaim }));
  assert.equal(j.calls.heartbeat, 0);
});

test("job acknowledgement is correlated to tenant and complete idempotency key", async () => {
  const j = jobsHarness(); j.jobs.createOrReuse = async () => ({ jobId: claim.jobId, organizationId: otherTenant, idempotencyKey: "fake" });
  await assert.rejects(requestThumbnailJob({ access, identity, authority: j.h.authority, jobs: j.jobs, signal: signal() }), /THUMBNAIL_JOB_BINDING_MISMATCH/);
});

test("claimed handler succeeds, repeat consumes verified cache and owns no scheduling", async () => {
  const j = jobsHarness();
  assert.equal((await processClaimedThumbnailJob(j.params)).status, "SUCCEEDED");
  const reused = await processClaimedThumbnailJob(j.params);
  assert.equal(reused.status, "SUCCEEDED"); assert.equal("cacheHit" in reused && reused.cacheHit, true);
  assert.equal(j.h.calls.generated, 1); assert.equal(j.h.calls.written, 1); assert.equal(j.calls.enqueued, 0);
});

test("cancelled/lost claims do no work and never write an execution failure", async () => {
  for (const status of ["CANCELLED", "LEASE_LOST"] as const) {
    const j = jobsHarness(); j.setStatus(status);
    assert.equal((await processClaimedThumbnailJob(j.params)).status, status);
    assert.equal(j.h.calls.generated, 0); assert.equal(j.calls.fail, 0); assert.equal(j.calls.complete, 0);
  }
});

test("durable cancellation during pending generation aborts noncooperative output; no publication", async () => {
  const j = jobsHarness(); let release: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    j.h.runtime.generateSprite = async (request) => {
      resolve(); await new Promise<void>((done) => { release = done; });
      return { bytes: stream(spriteFixture().bytes), sourceTimestampsMs: [...request.timestampsMs] };
    };
  });
  const pending = processClaimedThumbnailJob(j.params); await started;
  await cancelThumbnailJob({ access, identity, authority: j.h.authority, jobs: j.jobs, signal: signal() });
  assert.equal((await pending).status, "CANCELLED");
  release!(); await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(j.h.calls.written, 0); assert.equal(j.calls.complete, 0); assert.equal(j.calls.fail, 0);
});

test("stale lease at publication is fenced by infrastructure port, not an in-process mutex", async () => {
  const j = jobsHarness(); const generate = j.h.runtime.generateSprite;
  j.h.runtime.generateSprite = async (request) => { const result = await generate(request); j.setStatus("LEASE_LOST"); return result; };
  assert.equal((await processClaimedThumbnailJob(j.params)).status, "LEASE_LOST");
  assert.equal(j.h.calls.written, 0); assert.equal(j.calls.complete, 0);
});

test("completion ACK uncertainty preserves durable result without retrying/failing the job", async () => {
  for (const invalid of [false, true]) {
    const j = jobsHarness(); j.jobs.complete = async () => {
      j.calls.complete++;
      if (invalid) return "true" as unknown as boolean;
      throw new Error("ACK lost");
    };
    assert.equal((await processClaimedThumbnailJob(j.params)).status, "UNCONFIRMED");
    assert.equal(j.calls.complete, 1); assert.equal(j.calls.fail, 0); assert.equal(j.h.records.size, 1);
  }
});

test("execution errors are sanitized and missing renewal never grants execution authority", async () => {
  const j = jobsHarness(); j.h.runtime.probeSource = async () => { throw new Error("secret internal URL"); };
  let failure: string | undefined;
  j.jobs.fail = async (_, code) => { failure = code; return true; };
  assert.equal((await processClaimedThumbnailJob(j.params)).status, "FAILED");
  assert.equal(failure, "THUMBNAIL_EXECUTION_FAILED");
  const p = jobsHarness(); p.jobs.heartbeat = async () => { throw new Error("unknown renewal"); };
  assert.equal((await processClaimedThumbnailJob(p.params)).status, "LEASE_LOST");
  assert.equal(p.h.calls.generated, 0); assert.equal(p.calls.fail, 0);
});

test("local interruption releases handler but never overwrites a durable job as cancelled", async () => {
  const j = jobsHarness(); const controller = new AbortController(); controller.abort();
  assert.equal((await processClaimedThumbnailJob({ ...j.params, signal: controller.signal })).status, "INTERRUPTED");
  assert.equal(j.calls.fail, 0); assert.equal(j.calls.complete, 0);
});
