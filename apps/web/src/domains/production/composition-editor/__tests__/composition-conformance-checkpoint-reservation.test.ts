import test from "node:test";
import assert from "node:assert/strict";
import {readConformanceCheckpointReservation} from "../qa/composition-conformance-checkpoint-reservation";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const scope = {organizationId: uuid(1), requestId: uuid(2), revisionId: uuid(3),
  executionId: uuid(4), productionJobId: uuid(5)};
const claim = {id: uuid(6), organization_id: scope.organizationId, request_id: scope.requestId,
  revision_id: scope.revisionId, lease_token: uuid(7), attempts: 1};

test("checkpoint reservation rejects foreign tenant, request or revision before storage access", async () => {
  for (const field of ["organizationId", "requestId", "revisionId"] as const) {
    let reads = 0;
    await assert.rejects(readConformanceCheckpointReservation({scope: {...scope, [field]: uuid(99)},
      store: {read: async () => {reads++; throw new Error("Unexpected read");}}}, claim),
    /CONFORMANCE_JOB_CHECKPOINT_SCOPE_MISMATCH/);
    assert.equal(reads, 0);
  }
});

test("checkpoint reservation validates identifiers before reading the host journal", async () => {
  let reads = 0;
  await assert.rejects(readConformanceCheckpointReservation({scope: {...scope, executionId: "../latest"},
    store: {read: async () => {reads++; throw new Error("Unexpected read");}}}, claim));
  assert.equal(reads, 0);
});

test("cancelled checkpoint reservation does not read storage", async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  await assert.rejects(readConformanceCheckpointReservation({scope,
    store: {read: async () => {reads++; throw new Error("Unexpected read");}}}, claim, controller.signal));
  assert.equal(reads, 0);
});
