import assert from "node:assert/strict";
import test from "node:test";
import { compareVideoWithPersistedVisualReference } from "../qa/composition-persisted-reference-comparison";

const input = { supabase: {} as never, organizationId: "70000000-0000-4000-8000-000000000001",
  revisionId: "70000000-0000-4000-8000-000000000001", checksum: "a".repeat(64), outputParentDirectory: "owned-parent",
  videoPath: "authorized-local-video", renderReceiptPath: "integrity-gate-receipt", audioPolicyId: "course-v1" as const };
function fixture(failure?: "read" | "compare" | "cleanup") {
  const calls: string[] = [];
  const dependencies = {
    readReference: async () => {
      calls.push("read"); if (failure === "read") throw new Error("controlled read failure");
      return { contractPath: "verified-contract", previewDirectory: "verified-frames", previewMetadataPath: "verified-metadata",
        checksum: input.checksum, status: "VISUAL_CAPTURED_AUDIO_PENDING", receipt: {
          organizationId: input.organizationId, revisionId: input.revisionId, projectHash: "b".repeat(64), documentHash: "c".repeat(64),
        }, cleanup: async () => { calls.push("cleanup"); if (failure === "cleanup") throw new Error("private cleanup failure"); } };
    },
    compare: async (params: unknown) => {
      calls.push("compare"); assert.deepEqual(params, { videoPath: input.videoPath, renderReceiptPath: input.renderReceiptPath,
        audioPolicyId: "course-v1", contractPath: "verified-contract", previewDirectory: "verified-frames", previewMetadataPath: "verified-metadata" });
      if (failure === "compare") throw new Error("controlled comparison failure");
      return { status: "FAIL" };
    },
  } as unknown as NonNullable<Parameters<typeof compareVideoWithPersistedVisualReference>[1]>;
  return { calls, dependencies };
}
test("comparison consumes only verified reference paths, preserves failure status and disposes files", async () => {
  const state = fixture(); const result = await compareVideoWithPersistedVisualReference(input, state.dependencies);
  assert.deepEqual(state.calls, ["read", "compare", "cleanup"]);
  assert.equal(result.report.status, "FAIL"); assert.equal(result.reference.provenance, "SCOPED_WORKER_VISUAL_EVIDENCE");
  assert.equal(result.reference.status, "VISUAL_CAPTURED_AUDIO_PENDING");
});
test("explicit color tag policy reaches the actual comparator without replacing authorized paths", async () => {
  const state = fixture();
  state.dependencies.compare = async (params) => {
    assert.equal(params.colorTagPolicyId, "sdr-rec709-tags-v1");
    assert.equal(params.contractPath, "verified-contract");
    assert.equal(params.previewMetadataPath, "verified-metadata");
    return {status: "INCOMPLETE"} as Awaited<ReturnType<typeof state.dependencies.compare>>;
  };
  const result = await compareVideoWithPersistedVisualReference({...input, colorTagPolicyId: "sdr-rec709-tags-v1"}, state.dependencies);
  assert.equal(result.report.status, "INCOMPLETE");
  assert.deepEqual(state.calls, ["read", "cleanup"]);
});

test("partition comparison forwards its index and retains the verified lineage in provenance", async () => {
  const state = fixture(), read = state.dependencies.readReference;
  const eventBatchLineage = {policy: "VERIFIED_ROOT_EVENT_PARTITION_V1" as const,
    scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION" as const,
    parentContractSha256: "d".repeat(64), batchContractSha256: "e".repeat(64),
    batch: {planSha256: "f".repeat(64), batchIndex: 1, batchCount: 2, totalCheckpointCount: 80}};
  state.dependencies.readReference = async (params) => {
    assert.equal(params.eventBatchIndex, 1);
    const reference = await read(params);
    return {...reference, receipt: {...reference.receipt, eventBatchLineage}};
  };
  const result = await compareVideoWithPersistedVisualReference({...input, eventBatchIndex: 1}, state.dependencies);
  assert.deepEqual(result.reference.eventBatchLineage, eventBatchLineage);
  assert.equal(result.report.status, "FAIL");
});

test("raw measurements are explicitly requested without affecting ordinary comparison inputs", async () => {
  const state = fixture();
  state.dependencies.compare = async (params) => {
    assert.equal(params.includeVisualMeasurements, true); assert.equal(params.contractPath, "verified-contract");
    return {status: "INCOMPLETE"} as Awaited<ReturnType<typeof state.dependencies.compare>>;
  };
  assert.equal((await compareVideoWithPersistedVisualReference({...input, includeVisualMeasurements: true}, state.dependencies)).report.status,
    "INCOMPLETE");
});

test("failed read never compares; failed comparison still cleans up", async () => {
  for (const failure of ["read", "compare"] as const) {
    const state = fixture(failure); await assert.rejects(compareVideoWithPersistedVisualReference(input, state.dependencies));
    assert.deepEqual(state.calls, failure === "read" ? ["read"] : ["read", "compare", "cleanup"]);
  }
});
test("cleanup failure prevents handing off a successful comparison result", async () => {
  const state = fixture("cleanup");
  await assert.rejects(compareVideoWithPersistedVisualReference(input, state.dependencies), /CONFORMANCE_COMPARISON_CLEANUP_FAILED/);
});
