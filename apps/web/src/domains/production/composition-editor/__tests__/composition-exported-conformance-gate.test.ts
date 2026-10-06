import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExportedVideoConformanceStatus } from "../qa/composition-exported-conformance-gate";

const complete = {audioStatus: "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED", audioLoudnessStatus: "PASS",
  visualStatus: "PASS", audioTimingStatus: "PASS", audioRmsStatus: "PASS"} as const;

test("required audio cannot pass without loudness, timing and RMS obligations", () => {
  assert.equal(evaluateExportedVideoConformanceStatus(complete), "PASS");
  for (const audioLoudnessStatus of ["NOT_APPLICABLE", "MEASURED_POLICY_NOT_SET"] as const)
    assert.equal(evaluateExportedVideoConformanceStatus({...complete, audioLoudnessStatus}), "INCOMPLETE");
  for (const audioTimingStatus of [undefined, "NOT_REQUESTED", "INCOMPLETE"] as const)
    assert.equal(evaluateExportedVideoConformanceStatus({...complete, audioTimingStatus}), "INCOMPLETE");
  for (const audioRmsStatus of [undefined, "NOT_REQUESTED", "INCOMPLETE"] as const)
    assert.equal(evaluateExportedVideoConformanceStatus({...complete, audioRmsStatus}), "INCOMPLETE");
});

test("unknown expectation is incomplete; explicitly absent audio can skip unrequested measurements", () => {
  assert.equal(evaluateExportedVideoConformanceStatus({...complete, audioStatus: "EXPECTATION_UNKNOWN"}), "INCOMPLETE");
  assert.equal(evaluateExportedVideoConformanceStatus({audioStatus: "NOT_REQUIRED", audioLoudnessStatus: "NOT_APPLICABLE",
    visualStatus: "PASS", audioTimingStatus: "NOT_REQUESTED", audioRmsStatus: "NOT_REQUESTED"}), "PASS");
  assert.equal(evaluateExportedVideoConformanceStatus({...complete, audioStatus: "NOT_REQUIRED",
    audioLoudnessStatus: "MEASURED_POLICY_NOT_SET"}), "INCOMPLETE");
});

test("la carta RGB solicitada bloquea PASS si falla un checkpoint", () => {
  assert.equal(evaluateExportedVideoConformanceStatus({...complete, colorChartStatus: "PASS"}), "PASS");
  assert.equal(evaluateExportedVideoConformanceStatus({...complete, colorChartStatus: "FAIL"}), "FAIL");
});

test("failures dominate missing evidence across the entire measured-gate status matrix", () => {
  let checked = 0;
  for (const audioStatus of ["EXPECTATION_UNKNOWN", "MISSING_REQUIRED_TRACK", "NOT_REQUIRED", "REQUIRED_AUDIO_BELOW_FLOOR",
    "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED"] as const)
    for (const audioLoudnessStatus of ["NOT_APPLICABLE", "MEASURED_POLICY_NOT_SET", "PASS", "FAIL", "MEASUREMENT_FAILED"] as const)
      for (const visualStatus of ["PASS", "INCOMPLETE", "FAIL"] as const)
        for (const audioTimingStatus of [undefined, "NOT_REQUESTED", "PASS", "INCOMPLETE", "FAIL", "MEASUREMENT_FAILED"] as const)
          for (const audioRmsStatus of [undefined, "NOT_REQUESTED", "PASS", "INCOMPLETE", "FAIL"] as const) {
            const result = evaluateExportedVideoConformanceStatus({audioStatus, audioLoudnessStatus, visualStatus, audioTimingStatus, audioRmsStatus});
            const failed = visualStatus === "FAIL" || audioStatus === "MISSING_REQUIRED_TRACK" || audioStatus === "REQUIRED_AUDIO_BELOW_FLOOR"
              || audioLoudnessStatus === "FAIL" || audioLoudnessStatus === "MEASUREMENT_FAILED" || audioTimingStatus === "FAIL"
              || audioTimingStatus === "MEASUREMENT_FAILED" || audioRmsStatus === "FAIL";
            const incomplete = visualStatus === "INCOMPLETE" || audioStatus === "EXPECTATION_UNKNOWN"
              || audioLoudnessStatus === "MEASURED_POLICY_NOT_SET" || audioTimingStatus === "INCOMPLETE" || audioRmsStatus === "INCOMPLETE"
              || audioStatus === "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED"
                && (audioLoudnessStatus !== "PASS" || audioTimingStatus !== "PASS" || audioRmsStatus !== "PASS");
            assert.equal(result, failed ? "FAIL" : incomplete ? "INCOMPLETE" : "PASS");
            checked++;
          }
  assert.equal(checked, 2250);
});
