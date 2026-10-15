import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEventMeasurementGate, eventMeasurementGateSchema } from "../qa/composition-event-measurement-gate";
import { evaluateConformanceJobStatus } from "../qa/composition-conformance-job-status";
import { evaluateExportedColorTags, EXPORTED_COLOR_TAG_POLICY } from "../composition-color-tag-policy";

const coverage = {policy: "EVENT_VISUAL_COVERAGE_DIAGNOSTIC_V1" as const,
  scope: "VISUAL_SAMPLE_GATES_NOT_AUDIO_ENVIRONMENT_OR_RENDER_ATTESTATION" as const,
  status: "PASS" as const, blockedReasons: []};
function comparison() {
  return {status: "INCOMPLETE" as "PASS" | "FAIL" | "INCOMPLETE", visual: {status: "INCOMPLETE" as "PASS" | "FAIL" | "INCOMPLETE"},
    audioStatus: "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED", audioLoudness: {status: "PASS"},
    audioTiming: {status: "PASS", rms: {status: "PASS"}}, audioPlayback: {status: "PASS"},
    colorTags: evaluateExportedColorTags({matrix: "bt709", primaries: "bt709", transfer: "bt709", range: "tv"}, EXPORTED_COLOR_TAG_POLICY)};
}
test("measured recomposition resolves only partition coverage, never certifies environment or promotes the root", () => {
  const root = comparison(), result = evaluateEventMeasurementGate({comparison: root, visualCoverageGate: coverage});
  assert.equal(result.status, "PASS"); assert.equal(result.nonVisualStatus, "PASS");
  assert.deepEqual(result.blockedReasons, []);
  assert.equal(result.scope, "MEASURED_OBLIGATIONS_NOT_EFFECTIVE_RENDER_ENVIRONMENT_OR_QA");
  assert.equal(evaluateConformanceJobStatus({comparisonStatus: root.status, eventMeasurementStatus: result.status}), "INCOMPLETE");
  assert.equal(root.visual.status, "INCOMPLETE");
});
test("audio, loudness, timing, RMS, playback and color remain required after all visual partitions pass", () => {
  for (const [key, values] of [
    ["audioStatus", ["EXPECTATION_UNKNOWN", "MISSING_REQUIRED_TRACK", "REQUIRED_AUDIO_BELOW_FLOOR"]],
    ["audioLoudness", ["MEASURED_POLICY_NOT_SET", "NOT_APPLICABLE", "FAIL", "MEASUREMENT_FAILED"]],
    ["audioTiming", ["NOT_REQUESTED", "INCOMPLETE", "FAIL", "MEASUREMENT_FAILED"]],
    ["rms", ["NOT_REQUESTED", "INCOMPLETE", "FAIL"]],
    ["audioPlayback", ["INCOMPLETE", "FAIL"]],
  ] as const) for (const status of values) {
    const changed = comparison();
    if (key === "audioStatus") changed.audioStatus = status;
    else if (key === "rms") changed.audioTiming.rms.status = status;
    else changed[key].status = status;
    assert.notEqual(evaluateEventMeasurementGate({comparison: changed, visualCoverageGate: coverage}).status, "PASS", `${key}:${status}`);
  }
});
test("missing, unconfigured and mismatched color evidence blocks measured recomposition", () => {
  for (const colorTags of [undefined,
    evaluateExportedColorTags({matrix: "bt709", primaries: "bt709", transfer: "bt709", range: "tv"}),
    evaluateExportedColorTags({matrix: null, primaries: "bt709", transfer: "bt709", range: "tv"}, EXPORTED_COLOR_TAG_POLICY),
    evaluateExportedColorTags({matrix: "bt2020nc", primaries: "bt709", transfer: "bt709", range: "tv"}, EXPORTED_COLOR_TAG_POLICY),
  ]) {
    const changed = {...comparison(), colorTags};
    assert.notEqual(evaluateEventMeasurementGate({comparison: changed, visualCoverageGate: coverage}).status, "PASS");
  }
});
test("missing obligations and unexplained root statuses cannot be promoted; measurements FAIL dominate", () => {
  for (const key of ["audioStatus", "audioLoudness", "audioTiming", "visual"] as const) {
    const changed: Partial<ReturnType<typeof comparison>> = comparison(); delete changed[key];
    const gate = evaluateEventMeasurementGate({comparison: changed as ReturnType<typeof comparison>, visualCoverageGate: coverage});
    assert.equal(gate.status, "INCOMPLETE"); assert.ok(gate.blockedReasons.includes("NON_VISUAL_OBLIGATIONS_MISSING"));
  }
  const changed = comparison(); changed.status = "PASS";
  const mismatched = evaluateEventMeasurementGate({comparison: changed, visualCoverageGate: coverage});
  assert.equal(mismatched.status, "INCOMPLETE"); assert.ok(mismatched.blockedReasons.includes("ROOT_COMPARISON_STATUS_MISMATCH"));
  changed.audioPlayback.status = "FAIL";
  assert.equal(evaluateEventMeasurementGate({comparison: changed, visualCoverageGate: coverage}).status, "FAIL");
  assert.equal(eventMeasurementGateSchema.safeParse({...mismatched, status: "PASS"}).success, false);
});
test("visual failures and missing coverage survive successful non-visual measurements", () => {
  for (const status of ["FAIL", "INCOMPLETE"] as const) {
    const gate = evaluateEventMeasurementGate({comparison: comparison(), visualCoverageGate: {...coverage, status,
      blockedReasons: [status === "FAIL" ? "AGGREGATE_GATE_FAILED" : "AGGREGATE_COVERAGE_INCOMPLETE"]}});
    assert.equal(gate.status, status);
  }
});
