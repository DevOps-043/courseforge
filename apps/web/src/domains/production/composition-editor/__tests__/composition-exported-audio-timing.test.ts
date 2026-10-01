import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AUDIO_TIMING_POLICY, audioTimingDecodeArguments, buildStereoEnergyEnvelope, compareStereoEnergyEnvelopes, measureExportedAudioTiming } from "../qa/composition-exported-audio-timing";
import { evaluateExportedVideoConformanceStatus } from "../qa/composition-exported-video-conformance";

function envelope(seed: number, length = 1000): [number[], number[]] {
  let state = seed;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return 0.01 + state / 4294967296 * 0.5; };
  return [Array.from({ length }, next), Array.from({ length }, next)];
}
function shifted(reference: [number[], number[]], bins: number): [number[], number[]] {
  return reference.map((channel) => channel.map((_, index) => channel[index - bins] ?? 0)) as [number[], number[]];
}
function pcm(reference: [number[], number[]]): Buffer {
  const framesPerBin = AUDIO_TIMING_POLICY.sampleRate * AUDIO_TIMING_POLICY.binMilliseconds / 1000;
  const bytes = Buffer.alloc(reference[0].length * framesPerBin * 8);
  for (let bin = 0; bin < reference[0].length; bin++) for (let frame = 0; frame < framesPerBin; frame++) {
    const index = (bin * framesPerBin + frame) * 8;
    bytes.writeFloatLE(reference[0][bin]!, index); bytes.writeFloatLE(-reference[1][bin]!, index + 4);
  }
  return bytes;
}

test("stereo envelope preserves both channels even for opposite phases and rejects malformed PCM", () => {
  const reference = envelope(17, 2); reference[1] = [...reference[0]];
  const decoded = buildStereoEnergyEnvelope(pcm(reference));
  for (let index = 0; index < 2; index++) {
    assert.ok(Math.abs(decoded[0][index]! - reference[0][index]!) < 1e-7);
    assert.equal(decoded[0][index], decoded[1][index]);
  }
  for (const invalid of [Buffer.alloc(0), Buffer.alloc(7)]) assert.throws(() => buildStereoEnergyEnvelope(invalid));
  const invalid = Buffer.alloc(8); invalid.writeFloatLE(NaN, 0);
  assert.throws(() => buildStereoEnergyEnvelope(invalid), /PCM_INVALID/);
});

test("correlation alone is gain independent; signed lag respects 20 ms with explicit uncertainty", () => {
  const reference = envelope(13);
  const scaled = reference.map((channel) => channel.map((value) => value * 0.6)) as [number[], number[]];
  assert.equal(compareStereoEnergyEnvelopes(reference, scaled).status, "PASS");
  for (const bins of [-8, -4, -3, 3, 4, 8]) {
    const report = compareStereoEnergyEnvelopes(reference, shifted(reference, bins));
    assert.equal(report.lagMilliseconds, bins * AUDIO_TIMING_POLICY.binMilliseconds);
    assert.equal(report.status, Math.abs(bins) <= 3 ? "PASS" : Math.abs(bins) === 4 ? "INCOMPLETE" : "FAIL");
    assert.deepEqual(report.lagQuantizationBoundsMilliseconds, { minimum: bins * 5 - 5, maximum: bins * 5 + 5 });
  }
});

test("different content, channel loss, channel swap and duration mismatch do not pass", () => {
  const reference = envelope(13);
  assert.equal(compareStereoEnergyEnvelopes(reference, envelope(97)).reason, "LOW_ENVELOPE_SIMILARITY");
  assert.equal(compareStereoEnergyEnvelopes(reference, [reference[0], reference[1].map(() => 0)]).reason, "CHANNEL_ACTIVITY_MISMATCH");
  assert.equal(compareStereoEnergyEnvelopes(reference, [reference[1], reference[0]]).status, "FAIL");
  assert.equal(compareStereoEnergyEnvelopes(reference, envelope(13, 800)).reason, "AUDIO_DURATION_MISMATCH");
});

test("FPS real estrecha la tolerancia y una grilla demasiado gruesa no certifica un frame", () => {
  const reference = envelope(13);
  const frameDuration = 1000 / 60;
  assert.equal(compareStereoEnergyEnvelopes(reference, shifted(reference, 2), frameDuration).status, "PASS");
  assert.equal(compareStereoEnergyEnvelopes(reference, shifted(reference, 3), frameDuration).status, "INCOMPLETE");
  assert.equal(compareStereoEnergyEnvelopes(reference, shifted(reference, 4), frameDuration).status, "FAIL");
  assert.equal(compareStereoEnergyEnvelopes(reference, reference, 4).status, "INCOMPLETE");
  assert.equal(compareStereoEnergyEnvelopes(reference, reference, frameDuration).effectiveToleranceMilliseconds, frameDuration);
  for (const invalid of [NaN, Infinity, 0, -1]) assert.throws(() => compareStereoEnergyEnvelopes(reference, reference, invalid), /FRAME_DURATION_INVALID/);
});

test("silence, flat tones, repetitive content, short clips and search-boundary matches are inconclusive", () => {
  const silence: [number[], number[]] = [Array(1000).fill(0), Array(1000).fill(0)];
  assert.equal(compareStereoEnergyEnvelopes(silence, silence).reason, "SILENT_REFERENCE");
  const flat: [number[], number[]] = [Array(1000).fill(0.1), Array(1000).fill(0.1)];
  assert.equal(compareStereoEnergyEnvelopes(flat, flat).reason, "UNINFORMATIVE_ENVELOPE");
  const repetitive: [number[], number[]] = [Array.from({ length: 1000 }, (_, index) => index % 5 / 10), Array.from({ length: 1000 }, (_, index) => index % 5 / 10)];
  assert.equal(compareStereoEnergyEnvelopes(repetitive, repetitive).reason, "AMBIGUOUS_ALIGNMENT");
  assert.equal(compareStereoEnergyEnvelopes(envelope(1, 20), envelope(1, 20)).status, "INCOMPLETE");
  const reference = envelope(1);
  assert.equal(compareStereoEnergyEnvelopes(reference, shifted(reference, 100)).reason, "SEARCH_BOUNDARY");
});

test("600 segundos de señal plana no generan correlación por cancelación numérica", () => {
  const bins = AUDIO_TIMING_POLICY.maximumDurationSeconds * 1000 / AUDIO_TIMING_POLICY.binMilliseconds;
  const flat: [number[], number[]] = [Array(bins).fill(0.1), Array(bins).fill(0.3)];
  const report = compareStereoEnergyEnvelopes(flat, flat);
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.reason, "UNINFORMATIVE_ENVELOPE");
  assert.equal(report.correlation, null);
});

test("invalid envelope data and unbounded decode input are rejected; argv preserves time origin", () => {
  const invalid = envelope(1); invalid[0][0] = Infinity;
  assert.throws(() => compareStereoEnergyEnvelopes(invalid, envelope(1)), /ENVELOPE_INVALID/);
  for (const [file, duration] of [["https://remote.invalid/audio.wav", 5], ["audio.wav", 601], ["audio.wav", NaN]] as const) {
    assert.throws(() => audioTimingDecodeArguments(file, duration), /DECODE_INPUT_INVALID/);
  }
  const argumentsList = audioTimingDecodeArguments("audio with spaces.wav", 5);
  assert.ok(argumentsList.includes("file,pipe"));
  assert.ok(argumentsList.includes("aresample=8000:async=1:first_pts=0"));
  assert.equal(argumentsList.at(-1), "pipe:1");
});

test("timing failure gates the report; inconclusive timing never becomes PASS", () => {
  const base = { audioStatus: "NOT_REQUIRED" as const, audioLoudnessStatus: "PASS" as const, visualStatus: "PASS" as const };
  for (const status of ["FAIL", "MEASUREMENT_FAILED"] as const) assert.equal(evaluateExportedVideoConformanceStatus({ ...base, audioTimingStatus: status }), "FAIL");
  assert.equal(evaluateExportedVideoConformanceStatus({ ...base, audioTimingStatus: "INCOMPLETE" }), "INCOMPLETE");
  assert.equal(evaluateExportedVideoConformanceStatus({ ...base, audioTimingStatus: "NOT_REQUESTED" }), "PASS");
  assert.equal(evaluateExportedVideoConformanceStatus({ ...base, visualStatus: "FAIL", audioTimingStatus: "INCOMPLETE" }), "FAIL");
});

test("measurement binds reference hash/revision, detects mutation and rejects incomplete timeline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "audio-timing-test-"));
  const referencePath = join(directory, "reference.wav"); const referenceMetadataPath = join(directory, "reference.json");
  const referenceBytes = Buffer.from("controlled reference bytes"); const documentHash = "a".repeat(64);
  const audioSha256 = createHash("sha256").update(referenceBytes).digest("hex");
  const metadata = { documentHash, audioSha256 };
  const input = { ffmpegPath: "not-executed", videoPath: "video.mp4", referencePath, referenceMetadataPath, documentHash, durationSeconds: 5 };
  try {
    await writeFile(referencePath, referenceBytes); await writeFile(referenceMetadataPath, JSON.stringify(metadata));
    const decoded = pcm(envelope(13));
    assert.equal((await measureExportedAudioTiming(input, async () => decoded)).status, "PASS");
    await writeFile(referenceMetadataPath, JSON.stringify({ ...metadata, documentHash: "b".repeat(64) }));
    assert.equal((await measureExportedAudioTiming(input, async () => assert.fail("must not decode"))).reason, "AUDIO_TIMING_REFERENCE_REVISION_MISMATCH");
    await writeFile(referenceMetadataPath, JSON.stringify({ ...metadata, audioSha256: "b".repeat(64) }));
    assert.equal((await measureExportedAudioTiming(input, async () => assert.fail("must not decode"))).reason, "AUDIO_TIMING_REFERENCE_HASH_MISMATCH");
    await writeFile(referenceMetadataPath, JSON.stringify(metadata));
    assert.equal((await measureExportedAudioTiming(input, async () => pcm(envelope(13, 150)))).reason, "REFERENCE_OR_RENDER_DURATION_MISMATCH");
    assert.equal((await measureExportedAudioTiming(input, async () => {
      await writeFile(referencePath, "changed"); return decoded;
    })).reason, "AUDIO_TIMING_REFERENCE_CHANGED");
  } finally { await rm(referencePath, { force: true }); await rm(referenceMetadataPath, { force: true }); await rmdir(directory); }
});

test("decode failures and long timelines remain explicit rather than passing", async () => {
  const input = { ffmpegPath: "not-executed", videoPath: "video.mp4", referencePath: "missing.wav",
    referenceMetadataPath: "missing.json", documentHash: "a".repeat(64), durationSeconds: AUDIO_TIMING_POLICY.maximumDurationSeconds + 1 };
  assert.equal((await measureExportedAudioTiming(input)).reason, "DURATION_LIMIT");
  assert.equal((await measureExportedAudioTiming({ ...input, durationSeconds: 5 })).status, "MEASUREMENT_FAILED");
  for (const durationSeconds of [NaN, Infinity, 0, -1]) {
    assert.equal((await measureExportedAudioTiming({ ...input, durationSeconds }, async () => assert.fail("must not decode"))).reason,
      "AUDIO_TIMING_DECODE_INPUT_INVALID");
  }
});
