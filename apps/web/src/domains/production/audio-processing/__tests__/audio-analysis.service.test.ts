import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseAudioClip } from "../audio-clip-diagnostics";
import type { AudioLoudnessAnalysis } from "../audio-processing.types";
import {
  parseAudioProcessingDerivatives,
  parseAudioWaveformDerivative,
  selectAudioWaveformLevel,
} from "../audio-analysis.service";

const checksum = "a".repeat(64);
const measuredSource: AudioLoudnessAnalysis = {
  contractVersion: 1,
  integratedLufs: -16,
  loudnessRangeLu: 3,
  measuredThresholdLufs: -26,
  passed: true,
  targetIntegratedLufs: -16,
  targetTruePeakDbtp: -1.5,
  toleranceLu: 1,
  truePeakDbtp: -2,
};

test("estimates the clip peak with logarithmic gain without changing source measurements", () => {
  const diagnostics = diagnoseAudioClip(measuredSource, 0.5);
  assert.ok(Math.abs(diagnostics.gainDecibels! + 6.0206) < 0.0001);
  assert.ok(Math.abs(diagnostics.estimatedTruePeakDbtp! + 8.0206) < 0.0001);
  assert.equal(diagnostics.status, "MEASURED");
  assert.equal(measuredSource.truePeakDbtp, -2);
  assert.equal(measuredSource.integratedLufs, -16);
});

test("distinguishes muted, unmeasured and silent sources without inventing zero peaks", () => {
  assert.deepEqual(diagnoseAudioClip(undefined, 0), { estimatedTruePeakDbtp: null, gainDecibels: null, status: "MUTED" });
  assert.equal(diagnoseAudioClip(undefined, 1).status, "UNMEASURED");
  const silent = diagnoseAudioClip({ ...measuredSource, integratedLufs: null, truePeakDbtp: null, passed: false }, 1);
  assert.equal(silent.status, "SILENT");
  assert.equal(silent.estimatedTruePeakDbtp, null);
});

test("warns above the source peak target and retains a failed source diagnosis after attenuation", () => {
  const failedSource = { ...measuredSource, passed: false, truePeakDbtp: 0.5 };
  assert.equal(diagnoseAudioClip(failedSource, 1).status, "PEAK_ABOVE_TARGET");
  assert.equal(diagnoseAudioClip(failedSource, 0.1).status, "REVIEW_SOURCE");
  assert.equal(diagnoseAudioClip({ ...measuredSource, truePeakDbtp: null }, 1).status, "REVIEW_SOURCE");
});

test("rejects invalid gains instead of presenting misleading diagnostic levels", () => {
  for (const gain of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.01]) {
    assert.throws(() => diagnoseAudioClip(measuredSource, gain), /AUDIO_CLIP_GAIN_INVALID/);
  }
});

test("parses bounded loudness and content-addressed waveform metadata", () => {
  const parsed = parseAudioProcessingDerivatives({
    audio_analysis: {
      contract_version: 1,
      integrated_lufs: -16.2,
      loudness_range_lu: 3.4,
      measured_threshold_lufs: -26.1,
      passed: true,
      target_integrated_lufs: -16,
      target_true_peak_dbtp: -1.5,
      tolerance_lu: 1,
      true_peak_dbtp: -1.3,
    },
    waveform: {
      checksum,
      contract_version: 1,
      duration_seconds: 12,
      level_count: 2,
      sample_rate_hz: 400,
      storage_bucket: "production-assets",
      storage_path: `organizations/00000000-0000-4000-8000-000000000001/audio-analysis/${checksum}/waveform-v1.json`,
    },
  });

  assert.equal(parsed?.loudness.passed, true);
  assert.equal(parsed?.loudness.integratedLufs, -16.2);
  assert.equal(parsed?.waveform.checksum, checksum);
});

test("rejects malformed or non-content-addressed metadata", () => {
  assert.equal(parseAudioProcessingDerivatives({}), null);
  assert.equal(parseAudioProcessingDerivatives({
    audio_analysis: {},
    waveform: { checksum, storage_path: "waveform.json" },
  }), null);
});

test("validates the LOD chain and selects a bounded rendering level", () => {
  const waveform = parseAudioWaveformDerivative({
    contract_version: 1,
    duration_seconds: 2,
    sample_rate_hz: 400,
    levels: [
      { bucket_size_samples: 1, min: [-1, -0.8, -0.6, -0.4], max: [1, 0.8, 0.6, 0.4] },
      { bucket_size_samples: 2, min: [-1, -0.6], max: [1, 0.6] },
      { bucket_size_samples: 4, min: [-1], max: [1] },
    ],
  });
  assert.equal(selectAudioWaveformLevel(waveform, 1).bucketSizeSamples, 2);
  assert.throws(() => parseAudioWaveformDerivative({
    contract_version: 1,
    duration_seconds: 2,
    sample_rate_hz: 400,
    levels: [
      { bucket_size_samples: 1, min: [-0.5, -0.4], max: [0.5, 0.4] },
      { bucket_size_samples: 3, min: [-0.5], max: [0.5] },
    ],
  }), /AUDIO_WAVEFORM_LOD_SEQUENCE_INVALID/);
});
