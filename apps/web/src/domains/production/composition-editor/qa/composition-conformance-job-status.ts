type ConformanceStatus = "PASS" | "FAIL" | "INCOMPLETE";

/** Coverage can add a blocker, never erase unrelated obligations in the root comparison. */
export function evaluateConformanceJobStatus(input: {
  comparisonStatus: ConformanceStatus;
  eventStatus?: ConformanceStatus;
  eventVisualCoverageStatus?: ConformanceStatus;
  eventMeasurementStatus?: ConformanceStatus;
}): ConformanceStatus {
  const statuses = [input.comparisonStatus, input.eventStatus, input.eventVisualCoverageStatus, input.eventMeasurementStatus];
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("INCOMPLETE")) return "INCOMPLETE";
  return "PASS";
}
