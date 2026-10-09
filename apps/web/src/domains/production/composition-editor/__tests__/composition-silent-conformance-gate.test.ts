import test from "node:test";
import assert from "node:assert/strict";
import {COMPOSITION_CONFORMANCE_THRESHOLDS} from "../composition-preview-render-conformance";
import {assertSilentConformanceContract, assertSilentConformanceMeasurement} from "../qa/composition-silent-conformance-gate";
import {audioTimingReport} from "../qa/composition-exported-audio-timing";
import {evaluateExportedAudioLoudness} from "../qa/composition-exported-audio-loudness";
import {compareVideoWithPersistedVisualReference} from "../qa/composition-persisted-reference-comparison";

const documentHash = "a".repeat(64);
const contract = {schemaVersion: 2, audio: {required: false}, assets: [], documentHash,
  compilerContract: "courseforge-composition-preview-compiler-v1",
  canvas: {durationSeconds: 1, fps: 25, height: 1080, width: 1920},
  checkpoints: [{frameIndex: 0, timeSeconds: 0, reasons: ["test"]}],
  renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}, thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS};
const measurement = () => ({documentHash, audioStatus: "NOT_REQUIRED", audioTiming: audioTimingReport("NOT_REQUESTED"),
  audioLoudness: evaluateExportedAudioLoudness(null), video: {hasAudio: false}});
type Measurement = Parameters<typeof assertSilentConformanceMeasurement>[1];

test("explicit silent contract accepts no fabricated audio measurements", () => {
  assertSilentConformanceMeasurement(contract, measurement() as Measurement);
});

test("unknown or required audio cannot be reclassified as silence", () => {
  const {audio: _audio, ...legacy} = contract;
  assert.throws(() => assertSilentConformanceContract({...legacy, schemaVersion: 1}), /EXPECTATION_INVALID/);
  assert.throws(() => assertSilentConformanceContract({...contract, audio: {required: true}}), /EXPECTATION_INVALID/);
});

test("silent gate rejects audio tracks, foreign documents, timing, RMS, playback and reference claims", () => {
  for (const mutation of [
    {video: {hasAudio: true}}, {documentHash: "b".repeat(64)}, {audioStatus: "EXPECTATION_UNKNOWN"},
    {audioLoudness: {status: "MEASURED_POLICY_NOT_SET"}},
    {audioTiming: {...audioTimingReport("NOT_REQUESTED"), status: "PASS"}},
    {audioTiming: {...audioTimingReport("NOT_REQUESTED"), rms: {status: "PASS"}}},
    {audioTiming: {...audioTimingReport("NOT_REQUESTED"), referenceSha256: "c".repeat(64)}},
    {audioTiming: {...audioTimingReport("NOT_REQUESTED"), lagMilliseconds: 20}},
    {audioPlayback: {}},
  ]) assert.throws(() => assertSilentConformanceMeasurement(contract,
    {...measurement(), ...mutation} as Measurement), /MEASUREMENT_INVALID/);
});

test("persisted silent comparison checks frozen expectation before decoder and preserves incomplete or failure", async () => {
  for (const required of [false, true]) for (const status of ["INCOMPLETE", "FAIL"] as const) {
    let decoded = 0, cleaned = 0;
    const dependencies = {
      readReference: async () => ({contract: {...contract, audio: {required}}, contractPath: "verified-contract",
        previewDirectory: "verified-preview", previewMetadataPath: "verified-metadata", checksum: "b".repeat(64),
        receipt: {}, cleanup: async () => {cleaned++;}}),
      compare: async () => {decoded++; return {...measurement(), status};},
    } as unknown as NonNullable<Parameters<typeof compareVideoWithPersistedVisualReference>[1]>;
    const run = () => compareVideoWithPersistedVisualReference({supabase: {} as never,
      organizationId: "00000000-0000-4000-8000-000000000001", revisionId: "00000000-0000-4000-8000-000000000002",
      checksum: "b".repeat(64), outputParentDirectory: "owned", videoPath: "bound-video", renderReceiptPath: "bound-receipt",
      audioExpectation: "NOT_REQUIRED"}, dependencies);
    if (required) await assert.rejects(run(), /EXPECTATION_INVALID/);
    else assert.equal((await run()).report.status, status);
    assert.equal(decoded, required ? 0 : 1);
    assert.equal(cleaned, 1);
  }
});
