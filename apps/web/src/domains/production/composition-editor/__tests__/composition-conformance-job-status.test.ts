import assert from "node:assert/strict";
import test from "node:test";
import { evaluateConformanceJobStatus } from "../qa/composition-conformance-job-status";

test("global verdict preserves every measured blocker across all status combinations", () => {
  const statuses = ["PASS", "FAIL", "INCOMPLETE"] as const;
  for (const comparisonStatus of statuses) for (const eventStatus of statuses) for (const eventVisualCoverageStatus of statuses) for (const eventMeasurementStatus of statuses) {
    const evidence = [comparisonStatus, eventStatus, eventVisualCoverageStatus, eventMeasurementStatus];
    const expected = evidence.includes("FAIL") ? "FAIL" : evidence.includes("INCOMPLETE") ? "INCOMPLETE" : "PASS";
    assert.equal(evaluateConformanceJobStatus({comparisonStatus, eventStatus, eventVisualCoverageStatus, eventMeasurementStatus}), expected);
  }
});

test("legacy comparison remains unchanged when no partition diagnostic exists", () => {
  for (const comparisonStatus of ["PASS", "FAIL", "INCOMPLETE"] as const)
    assert.equal(evaluateConformanceJobStatus({comparisonStatus}), comparisonStatus);
  assert.equal(evaluateConformanceJobStatus({comparisonStatus: "PASS", eventStatus: "PASS",
    eventVisualCoverageStatus: "INCOMPLETE"}), "INCOMPLETE");
  assert.equal(evaluateConformanceJobStatus({comparisonStatus: "INCOMPLETE", eventStatus: "PASS",
    eventVisualCoverageStatus: "PASS"}), "INCOMPLETE");
});
