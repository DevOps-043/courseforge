import assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {createConformanceJobLease, assertConformanceJobActive} from "../qa/composition-conformance-job-lease";

test("renewal loss cancels execution and a later success cannot restore ownership", async () => {
  const lease = createConformanceJobLease({heartbeatMs: 10, renewalTimeoutMs: 20, renew: async () => false});
  try {
    await new Promise<void>(resolve => lease.signal.addEventListener("abort", () => resolve(), {once: true}));
    assert.equal(lease.lost, true); assert.throws(() => assertConformanceJobActive(lease.signal), /EXECUTION_CANCELLED/);
  } finally {await lease.close();}
});
test("slow renewal is coalesced instead of accumulating an unbounded queue", async () => {
  let calls = 0, acknowledge!: (value: boolean) => void;
  const lease = createConformanceJobLease({heartbeatMs: 10, renewalTimeoutMs: 500, renew: () => {
    calls++; return new Promise(resolve => {acknowledge = resolve;});
  }});
  try {await delay(60); assert.equal(calls, 1); acknowledge(true);}
  finally {await lease.close();}
  const before = calls; await delay(30); assert.equal(calls, before); assert.equal(lease.lost, false);
});
test("a non-cooperative renewal times out, aborts its request and cannot revive its lease", async () => {
  let signal: AbortSignal | undefined, acknowledge!: (value: boolean) => void;
  const lease = createConformanceJobLease({heartbeatMs: 10, renewalTimeoutMs: 20, renew: received => {
    signal = received; return new Promise(resolve => {acknowledge = resolve;});
  }});
  await new Promise<void>(resolve => lease.signal.addEventListener("abort", () => resolve(), {once: true}));
  await lease.close(); assert.equal(signal!.aborted, true); acknowledge(true);
  await delay(0); assert.equal(lease.lost, true);
});
test("worker shutdown cancels execution without leaking caller reasons or claiming lease loss", async () => {
  const external = new AbortController();
  const lease = createConformanceJobLease({signal: external.signal, renew: async () => true});
  external.abort("private token");
  assert.equal(lease.signal.reason.message, "CONFORMANCE_JOB_EXECUTION_CANCELLED"); assert.equal(lease.lost, false);
  await lease.close();
});
test("pre-aborted shutdown and invalid timer budgets fail before renewal", async () => {
  const external = new AbortController(); external.abort();
  const lease = createConformanceJobLease({signal: external.signal, renew: async () => assert.fail("not called")});
  assert.equal(lease.signal.aborted, true); await lease.close();
  for (const patch of [{heartbeatMs: 0}, {heartbeatMs: 10.5}, {heartbeatMs: 60001}, {renewalTimeoutMs: 30001}, {renewalTimeoutMs: NaN}])
    assert.throws(() => createConformanceJobLease({...patch, renew: async () => true}), /HEARTBEAT_INVALID/);
});
