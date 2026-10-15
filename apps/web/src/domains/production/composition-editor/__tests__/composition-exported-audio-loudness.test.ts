import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExportedVideoConformanceStatus } from "../qa/composition-exported-video-conformance";
import {
  buildExportedAudioLoudnessArgs,
  evaluateExportedAudioLoudness,
  measureExportedAudioLoudness,
  parseExportedAudioLoudness,
  resolveExportedAudioLoudnessPolicyId,
} from "../qa/composition-exported-audio-loudness";

const output = (input: Record<string, string> = {}) => `[Parsed_loudnorm_0 @ 00000001]\n${JSON.stringify({
  input_i: "-16.00", input_tp: "-1.50", input_lra: "3.40", input_thresh: "-26.10",
  output_i: "-16.00", output_tp: "-1.50", ...input,
})}`;

test("audio failure invalidates the combined report even with passing visual checkpoints", () => {
  for (const audioLoudnessStatus of ["FAIL", "MEASUREMENT_FAILED"] as const) {
    assert.equal(evaluateExportedVideoConformanceStatus({ audioStatus: "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED", audioLoudnessStatus, visualStatus: "PASS" }), "FAIL");
  }
  assert.equal(evaluateExportedVideoConformanceStatus({ audioStatus: "MISSING_REQUIRED_TRACK", audioLoudnessStatus: "NOT_APPLICABLE", visualStatus: "PASS" }), "FAIL");
  assert.equal(evaluateExportedVideoConformanceStatus({ audioStatus: "EXPECTATION_UNKNOWN", audioLoudnessStatus: "NOT_APPLICABLE", visualStatus: "PASS" }), "INCOMPLETE");
  assert.equal(evaluateExportedVideoConformanceStatus({ audioStatus: "SIGNAL_ABOVE_FLOOR_NOT_FULLY_EVALUATED", audioLoudnessStatus: "PASS", visualStatus: "FAIL" }), "FAIL");
});

test("measures the exported input, never the discarded normalized output", () => {
  const measurement = parseExportedAudioLoudness(output({ input_i: "-25.00", input_tp: "0.50" }));
  assert.equal(measurement.integratedLufs, -25);
  assert.equal(measurement.truePeakDbtp, 0.5);
  const evaluated = evaluateExportedAudioLoudness(measurement, "course-v1");
  assert.equal(evaluated.status, "FAIL");
  assert.deepEqual(evaluated.failures, ["LOUDNESS_OUTSIDE_TOLERANCE", "TRUE_PEAK_ABOVE_LIMIT"]);
});

test("requires explicit policy for approval and applies inclusive loudness/peak limits", () => {
  const measurement = parseExportedAudioLoudness(output());
  assert.equal(evaluateExportedAudioLoudness(measurement).status, "MEASURED_POLICY_NOT_SET");
  for (const integratedLufs of [-17, -15]) {
    assert.equal(evaluateExportedAudioLoudness({ ...measurement, integratedLufs, truePeakDbtp: -1 }, "course-v1").status, "PASS");
  }
  assert.equal(evaluateExportedAudioLoudness({ ...measurement, integratedLufs: -17.01 }, "course-v1").status, "FAIL");
  assert.equal(evaluateExportedAudioLoudness({ ...measurement, truePeakDbtp: -0.99 }, "course-v1").status, "FAIL");
  assert.equal(evaluateExportedAudioLoudness(null).status, "NOT_APPLICABLE");
  assert.equal(resolveExportedAudioLoudnessPolicyId(undefined), undefined);
  assert.throws(() => resolveExportedAudioLoudnessPolicyId("typo"), /POLICY_INVALID/);
});

test("reports silence and incomplete measurements without serializing Infinity as a valid level", () => {
  const silent = parseExportedAudioLoudness(output({ input_i: "-inf", input_tp: "-inf", input_lra: "0.00" }));
  assert.equal(silent.integratedLufs, null);
  assert.equal(silent.truePeakDbtp, null);
  const evaluated = evaluateExportedAudioLoudness(silent, "course-v1");
  assert.equal(evaluated.status, "FAIL");
  assert.deepEqual(evaluated.failures, ["SILENT_OR_UNMEASURABLE"]);
  assert.equal(evaluateExportedAudioLoudness({ ...silent, truePeakDbtp: -2 }, "course-v1").status, "FAIL");
  assert.doesNotMatch(JSON.stringify(evaluated), /Infinity/);
});

test("rejects unbounded, malformed and unlabeled measurements", () => {
  assert.throws(() => parseExportedAudioLoudness("x".repeat(512 * 1024 + 1)), /OUTPUT_TOO_LARGE/);
  assert.throws(() => parseExportedAudioLoudness('{"input_i":"-16"}'), /MEASUREMENT_MISSING/);
  const invalidMeasurements: Record<string, string>[] = [{ input_i: "NaN" }, { input_tp: "+inf" }, { input_lra: "-1" }, { input_tp: "1000" }];
  for (const input of invalidMeasurements) {
    assert.throws(() => parseExportedAudioLoudness(output(input)), /MEASUREMENT_INVALID/);
  }
  assert.throws(() => parseExportedAudioLoudness(`${output()}\n[Parsed_loudnorm_1 @ 00000002]\n{"input_i":"bad"}`), /MEASUREMENT_INVALID/);
});

test("analyzes the final local artifact with bounded execution and no shell or output file", async () => {
  const videoPath = "final mix with spaces.mp4";
  const report = await measureExportedAudioLoudness({
    ffmpegPath: "ffmpeg", videoPath, policyId: "course-v1",
    execute: async (binary, args, options) => {
      assert.equal(binary, "ffmpeg");
      assert.equal(args[args.indexOf("-i") + 1], videoPath);
      assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
      assert.deepEqual(args.slice(-3), ["-f", "null", "-"]);
      assert.equal(options.timeout, 600000);
      assert.equal(options.maxBuffer, 512 * 1024);
      assert.equal(options.windowsHide, true);
      return { stderr: output() };
    },
  });
  assert.equal(report.status, "PASS");
  for (const path of ["https://host/final.mp4", "file:///final.mp4", "bad\0path"]) {
    assert.throws(() => buildExportedAudioLoudnessArgs(path), /PATH_INVALID/);
  }
});

test("command failure and invalid output remain explicit failures with no fake measurement", async () => {
  for (const execute of [async () => { throw new Error("Sensitive path or FFmpeg log"); }, async () => ({ stderr: "no measurement" })]) {
    const report = await measureExportedAudioLoudness({ ffmpegPath: "ffmpeg", videoPath: "final.mp4", policyId: "course-v1", execute });
    assert.equal(report.status, "MEASUREMENT_FAILED");
    assert.equal(report.measurement, null);
    assert.deepEqual(report.failures, ["MEASUREMENT_FAILED"]);
    assert.doesNotMatch(JSON.stringify(report), /Sensitive/);
  }
});
