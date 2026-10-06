import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ConformanceStageFailure, conformanceExecutionStageSchema, recordConformanceCleanupFailure,
  wrapConformanceStageFailure } from "../qa/composition-conformance-stage-failure";
import { classifyConformanceJobFailure } from "../qa/composition-conformance-job-worker";

test("every failed boundary produces a SQL-compatible code without retaining private messages or causes", () => {
  for (const stage of conformanceExecutionStageSchema.options) {
    const error = wrapConformanceStageFailure(stage, new Error("https://private.invalid/?token=secret /private/path"));
    assert.equal(error.stage, stage); assert.equal(error.retryable, true);
    assert.match(error.errorCode, /^CONFORMANCE_JOB_[A-Z_]+$/);
    assert.equal(classifyConformanceJobFailure(error).code, error.errorCode);
    assert.ok(!JSON.stringify(error).includes("secret")); assert.ok(!error.stack?.includes("private.invalid"));
    assert.equal("cause" in error, false);
    assert.throws(() => {Object.assign(error, {stage: "SECRET"});});
  }
});
test("canonical integrity rejection and validation failures preserve non-retry semantics without Zod input values", () => {
  assert.equal(new ConformanceStageFailure("REMOTE_SNAPSHOT", new Error("VIDEO_INTEGRITY_OVERWRITTEN")).retryable, false);
  const invalid = z.object({hash: z.string().regex(/^[a-f0-9]{64}$/)}).safeParse({hash: "secret"});
  assert.equal(invalid.success, false); if (invalid.success) throw new Error("Expected failure");
  const wrapped = new ConformanceStageFailure("REPORT_VALIDATION", invalid.error);
  assert.equal(wrapped.retryable, false); assert.ok(!wrapped.message.includes("secret"));
  assert.equal(classifyConformanceJobFailure(wrapped).code, "CONFORMANCE_JOB_REPORT_VALIDATION_REJECTED");
});
test("cleanup failure retains the primary failed boundary and nested wrappers do not relabel it", () => {
  const primary = new ConformanceStageFailure("PREVIEW_REFERENCE", new Error("CONFORMANCE_JOB_REVISION_MISMATCH"));
  assert.equal(wrapConformanceStageFailure("REPORT_VALIDATION", primary), primary);
  const combined = recordConformanceCleanupFailure(primary);
  assert.equal(combined.stage, "PREVIEW_REFERENCE"); assert.equal(combined.cleanupFailed, true);
  assert.equal(combined.retryable, false);
  assert.equal(combined.errorCode, "CONFORMANCE_JOB_PREVIEW_REFERENCE_WITH_CLEANUP_REJECTED");
  assert.equal(recordConformanceCleanupFailure().stage, "RESOURCE_CLEANUP");
});
