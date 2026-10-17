import assert from "node:assert/strict";
import test from "node:test";
import { buildEventBatchDiagnostic, eventExecutionDiagnosticsSchema, EVENT_DIAGNOSTIC_MAX_BATCHES } from "../qa/composition-event-diagnostics";
import type { CompositionConformanceReport } from "../composition-preview-render-conformance";

function report(): CompositionConformanceReport {
  return {status: "FAIL", checkedCheckpointCount: 1, requiredCheckpointCount: 1,
    observed: {maxMeanAbsoluteError: 1, maxMismatchedPixelRatio: 0.1, maxTemporalDriftFrames: 0, minPsnrDb: 40},
    failures: [{metric: "ssim", frameIndex: 25, message: "private-caption https://signed.example?token=secret"}],
    incompletenessReasons: ["EVENT_PARTITION_COVERAGE"]};
}

test("diagnostic records frame/metric/hash and never evaluator messages or signed URLs", () => {
  const diagnostic = buildEventBatchDiagnostic(report(), 2, "a".repeat(64));
  assert.deepEqual(diagnostic.firstFailure, {metric: "ssim", frameIndex: 25});
  assert.deepEqual(diagnostic.incompleteReasons, []);
  assert.equal(JSON.stringify(diagnostic).includes("private"), false);
  assert.equal(JSON.stringify(diagnostic).includes("https"), false);
  const unknown = report(); unknown.failures[0]!.metric = "signed.example";
  assert.throws(() => buildEventBatchDiagnostic(unknown, 2, "a".repeat(64)));
});

test("incomplete evidence carries exact typed reasons without claiming a failed measurement", () => {
  const incomplete = report(); incomplete.status = "INCOMPLETE"; incomplete.failures = [];
  incomplete.incompletenessReasons = ["SSIM_CHECKPOINTS_MISSING", "RENDERER_FONT_USAGE_UNAVAILABLE", "EVENT_PARTITION_COVERAGE"];
  const diagnostic = buildEventBatchDiagnostic(incomplete, 0, "a".repeat(64));
  assert.equal(diagnostic.failureCount, 0); assert.equal(diagnostic.firstFailure, undefined);
  assert.deepEqual(diagnostic.incompleteReasons, ["SSIM_CHECKPOINTS_MISSING", "RENDERER_FONT_USAGE_UNAVAILABLE"]);
});

test("bounded diagnostics make omissions explicit and reject duplicate or oversized lists", () => {
  const batches = Array.from({length: EVENT_DIAGNOSTIC_MAX_BATCHES}, (_, index) => buildEventBatchDiagnostic(report(), index, "a".repeat(64)));
  const input = {scope: "FIRST_AFFECTED_PARTITIONS_NOT_COMPLETE_FAILURE_LIST", affectedBatchCount: 750, omittedBatchCount: 734, batches};
  assert.equal(eventExecutionDiagnosticsSchema.safeParse(input).success, true);
  assert.equal(eventExecutionDiagnosticsSchema.safeParse({...input, omittedBatchCount: 0}).success, false);
  assert.equal(eventExecutionDiagnosticsSchema.safeParse({...input, batches: [...batches, batches[0]]}).success, false);
  assert.equal(eventExecutionDiagnosticsSchema.safeParse({...input, batches: batches.map((batch) => ({...batch, batchIndex: 0}))}).success, false);
});
