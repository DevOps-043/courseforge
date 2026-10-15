import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {assertConformanceAttemptBinding, bindConformanceReportToAttempt,
  CONFORMANCE_ATTEMPT_BINDING_POLICY} from "../qa/composition-conformance-attempt-binding";

const claim = {id: "abcdef01-0000-4000-8000-000000000001", attempts: 1,
  lease_token: "abcdef02-0000-4000-8000-000000000002"};

test("attempt binding is deterministic, canonical and does not expose the lease token", () => {
  const binding = bindConformanceReportToAttempt(claim);
  assertConformanceAttemptBinding(binding, claim);
  assert.deepEqual(binding, bindConformanceReportToAttempt({...claim, id: claim.id.toUpperCase(),
    lease_token: claim.lease_token.toUpperCase()}));
  assert.equal(binding.leaseFingerprint, createHash("sha256")
    .update(`${CONFORMANCE_ATTEMPT_BINDING_POLICY}:${claim.lease_token}`).digest("hex"));
  assert.equal(JSON.stringify(binding).includes(claim.lease_token), false);
});

test("different job, retry or renewed reservation cannot reuse the old report", () => {
  const binding = bindConformanceReportToAttempt(claim);
  for (const changed of [{...claim, id: claim.lease_token}, {...claim, attempts: 2},
    {...claim, lease_token: claim.id}]) {
    assert.throws(() => assertConformanceAttemptBinding(binding, changed), /ATTEMPT_BINDING_INVALID/);
  }
});

test("missing, null, malformed and extended bindings are rejected", () => {
  const binding = bindConformanceReportToAttempt(claim);
  for (const value of [undefined, null, {}, {...binding, attempt: 0}, {...binding, extra: true},
    {...binding, policy: "SIGNED_ATTESTATION"}, {...binding, leaseFingerprint: "a".repeat(64)}]) {
    assert.throws(() => assertConformanceAttemptBinding(value, claim), /ATTEMPT_BINDING_INVALID/);
  }
});

test("invalid claim fails before a binding is constructed", () => {
  for (const changed of [{...claim, id: "not-a-job"}, {...claim, attempts: 6}, {...claim, lease_token: "secret"}])
    assert.throws(() => bindConformanceReportToAttempt(changed));
});
