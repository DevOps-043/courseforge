import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioLoudnessQualityError,
  buildLoudnessAnalysisArgs,
  parseLoudnessAnalysis,
  requirePassingAudioLoudness,
} from "../audio-analysis";

const target = { integratedLufs: -16, loudnessRangeLu: 11, truePeakDbtp: -1.5 };

test("builds a shell-free loudness measurement command", () => {
  const args = buildLoudnessAnalysisArgs("C:/worker/processed.m4a", target);
  assert.ok(args.includes("loudnorm=I=-16:LRA=11:TP=-1.5:print_format=json"));
  assert.deepEqual(args.slice(-3), ["-f", "null", "-"]);
  assert.throws(
    () => buildLoudnessAnalysisArgs("https://untrusted.example/audio.m4a", target),
    /AUDIO_ANALYSIS_INPUT_PATH_INVALID/,
  );
});

test("parses measured values and applies the phase-two QA thresholds", () => {
  const analysis = parseLoudnessAnalysis(`diagnostic\n{
    "input_i" : "-16.40",
    "input_tp" : "-1.20",
    "input_lra" : "3.10",
    "input_thresh" : "-26.50",
    "output_i" : "-16.00"
  }\n`, target);

  assert.equal(analysis.integrated_lufs, -16.4);
  assert.equal(analysis.true_peak_dbtp, -1.2);
  assert.equal(analysis.passed, true);
  assert.doesNotThrow(() => requirePassingAudioLoudness(analysis));
});

test("marks out-of-tolerance loudness or clipping risk without hiding measurements", () => {
  const analysis = parseLoudnessAnalysis(`{
    "input_i":"-13.0","input_tp":"-0.3","input_lra":"2.0","input_thresh":"-24.0"
  }`, target);
  assert.equal(analysis.passed, false);
  assert.throws(() => requirePassingAudioLoudness(analysis), AudioLoudnessQualityError);
  assert.equal(analysis.integrated_lufs, -13);
  assert.throws(() => parseLoudnessAnalysis("no measurement", target), /AUDIO_ANALYSIS_MEASUREMENT_MISSING/);
});

test("represents digital silence as an explicit failed measurement", () => {
  const analysis = parseLoudnessAnalysis(`{
    "input_i":"-inf","input_tp":"-inf","input_lra":"0.0","input_thresh":"-inf"
  }`, target);
  assert.equal(analysis.integrated_lufs, null);
  assert.equal(analysis.true_peak_dbtp, null);
  assert.equal(analysis.passed, false);
  assert.throws(() => requirePassingAudioLoudness(analysis), /AUDIO_LOUDNESS_QA_FAILED/);
});
