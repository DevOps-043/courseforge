import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AUDIO_RMS_WINDOW_POLICY, AUDIO_TIMING_POLICY } from "../qa/composition-audio-conformance-policy";
import { buildStereoPcmEnergyWindows, compareStereoRmsWindows } from "../qa/composition-audio-rms-windows";
import { measureExportedAudioTiming } from "../qa/composition-exported-audio-timing";

function stereoPcm(frameCount: number, amplitude: (frame: number, channel: number) => number) {
  const pcm = Buffer.alloc(frameCount * 8);
  for (let frame = 0; frame < frameCount; frame++) for (let channel = 0; channel < 2; channel++) {
    pcm.writeFloatLE(amplitude(frame, channel), frame * 8 + channel * 4);
  }
  return pcm;
}
const framesPerWindow = AUDIO_RMS_WINDOW_POLICY.sampleRate * AUDIO_RMS_WINDOW_POLICY.windowMilliseconds / 1_000;
const windows = (pcm: Buffer) => buildStereoPcmEnergyWindows(pcm, AUDIO_RMS_WINDOW_POLICY.windowMilliseconds);
test("ventanas canónicas incluyen cola parcial y no cancelan fases estéreo", () => {
  const result = windows(stereoPcm(framesPerWindow * 2 + 3, (_, channel) => channel ? -0.2 : 0.2));
  assert.deepEqual(result.sampleCounts, [160, 160, 3]);
  assert.deepEqual(result.channels[0], result.channels[1]);
  assert.ok(result.channels[0].every((value) => Math.abs(value - 0.2) < 1e-7));
});
test("compara cada canal sin normalizar: dentro de 0.5 dB pasa y fuera falla", () => {
  const reference = windows(stereoPcm(320, () => 0.2));
  for (const db of [-0.49, 0, 0.49, -0.51, 0.51, -4.4, 4.4]) {
    const rendered = windows(stereoPcm(320, () => 0.2 * 10 ** (db / 20)));
    const report = compareStereoRmsWindows(reference, rendered);
    assert.equal(report.status, Math.abs(db) < 0.5 ? "PASS" : "FAIL");
    assert.ok(Math.abs(report.maximumObservedDeltaDb! - Math.abs(db)) < 1e-5);
    assert.equal(report.comparedChannelWindows, 4);
  }
});
test("una ventana alterada no se oculta mediante promedio global", () => {
  const reference = windows(stereoPcm(1600, () => 0.2));
  const rendered = windows(stereoPcm(1600, (frame, channel) => channel === 1 && frame >= 640 && frame < 800 ? 0.1 : 0.2));
  const report = compareStereoRmsWindows(reference, rendered);
  assert.equal(report.failedChannelWindows, 1);
  assert.equal(report.status, "FAIL"); assert.equal(report.failures[0]!.windowIndex, 4); assert.equal(report.failures[0]!.channel, 1);
});
test("pérdida de canal/silencio y recuperación de actividad fallan sin Infinity serializado", () => {
  const reference = windows(stereoPcm(320, () => 0.2)), silence = windows(stereoPcm(320, () => 0));
  for (const [left, right] of [[reference, silence], [silence, reference]]) {
    const result = compareStereoRmsWindows(left!, right!);
    assert.equal(result.status, "FAIL"); assert.equal(result.failures[0]!.reason, "CHANNEL_ACTIVITY_MISMATCH");
    assert.equal(result.maximumObservedDeltaDb, null);
    assert.equal(JSON.parse(JSON.stringify(result)).failures[0].deltaDb, null);
  }
  assert.equal(compareStereoRmsWindows(silence, silence).status, "INCOMPLETE");
});
test("cola o cobertura distinta es inconclusa, nunca se recorta para hacerla pasar", () => {
  const reference = windows(stereoPcm(323, () => 0.2));
  for (const length of [320, 322, 324, 480]) {
    assert.equal(compareStereoRmsWindows(reference, windows(stereoPcm(length, () => 0.2))).reason, "CANONICAL_WINDOW_COVERAGE_MISMATCH");
  }
});
test("silencio válido junto a actividad se cuenta y cola parcial alterada se detecta", () => {
  const source = stereoPcm(163, (frame) => frame < 160 ? 0 : 0.2);
  const modified = stereoPcm(163, (frame) => frame < 160 ? 0 : 0.1);
  const result = compareStereoRmsWindows(windows(source), windows(modified));
  assert.equal(result.silentChannelWindows, 2); assert.equal(result.failedChannelWindows, 2);
  assert.equal(result.failures[0]!.windowIndex, 1);
});
test("registra máximo y conteo íntegros pero limita muestras de fallos", () => {
  const reference = windows(stereoPcm(1600, () => 0.2)), rendered = windows(stereoPcm(1600, () => 0.1));
  const result = compareStereoRmsWindows(reference, rendered);
  assert.equal(result.failedChannelWindows, 20);
  assert.equal(result.failures.length, AUDIO_RMS_WINDOW_POLICY.maximumRecordedFailures);
});
test("rechaza PCM, dimensiones y muestras inválidos sin interpretar NaN como conformidad", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(7), stereoPcm(1, () => NaN), stereoPcm(1, () => 33)]) {
    assert.throws(() => windows(bytes), /PCM_INVALID/);
  }
  const reference = windows(stereoPcm(320, () => 0.2));
  for (const malformed of [
    { ...reference, sampleCounts: [159, 160] },
    { ...reference, channels: [reference.channels[0], []] as [number[], number[]] },
    { ...reference, channels: [[Infinity, 0.2], reference.channels[1]] as [number[], number[]] },
  ]) assert.throws(() => compareStereoRmsWindows(reference, malformed), /WINDOWS_INVALID/);
});

test("límite de duración permanece acotado y el piso de silencio se declara explícitamente", () => {
  const maximumBytes = AUDIO_TIMING_POLICY.sampleRate * (AUDIO_TIMING_POLICY.maximumDurationSeconds + 1) * 8;
  assert.throws(() => windows(Buffer.alloc(maximumBytes + 8)), /PCM_INVALID/);
  const result = compareStereoRmsWindows(windows(stereoPcm(320, () => 0.00001)), windows(stereoPcm(320, () => 0.00005)));
  assert.equal(result.status, "INCOMPLETE"); assert.equal(result.reason, "SILENT_PROGRAM");
  assert.equal(result.silentChannelWindows, 4); assert.equal(result.comparedChannelWindows, 0);
});

test("medición integrada detecta ganancia que pasa correlación y conserva RMS aunque lag sea ambiguo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "audio-rms-measurement-"));
  const referencePath = join(directory, "reference.wav"), referenceMetadataPath = join(directory, "metadata.json");
  const referenceBytes = Buffer.from("controlled reference");
  const documentHash = "a".repeat(64), audioSha256 = createHash("sha256").update(referenceBytes).digest("hex");
  const params = { ffmpegPath: "not-launched", videoPath: "final.mp4", referencePath, referenceMetadataPath, documentHash, durationSeconds: 5 };
  try {
    await writeFile(referencePath, referenceBytes); await writeFile(referenceMetadataPath, JSON.stringify({ documentHash, audioSha256 }));
    let state = 13;
    const gains = Array.from({ length: 1000 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return 0.1 + state / 4294967296 * 0.4; });
    const reference = stereoPcm(40_000, (frame, channel) => gains[Math.floor(frame / 40)]! * (channel ? -1 : 1));
    const scaled = stereoPcm(40_000, (frame, channel) => gains[Math.floor(frame / 40)]! * 0.6 * (channel ? -1 : 1));
    const result = await measureExportedAudioTiming(params, async (path) => path === referencePath ? reference : scaled);
    assert.equal(result.correlation! > 0.999, true); assert.equal(result.status, "FAIL");
    assert.equal(result.rms.status, "FAIL"); assert.equal(result.reason, "RMS_WINDOW_MISMATCH");
    assert.equal(result.alignment!.status, "PASS", "conservar diagnóstico de timing separado del RMS");
    assert.equal(result.referenceSha256, audioSha256); assert.equal(result.policy.toleranceMilliseconds, 20);
    const flat = stereoPcm(40_000, () => 0.2), flatScaled = stereoPcm(40_000, () => 0.1);
    const ambiguous = await measureExportedAudioTiming(params, async (path) => path === referencePath ? flat : flatScaled);
    assert.equal(ambiguous.status, "FAIL"); assert.equal(ambiguous.rms.failedChannelWindows, 500);
    assert.equal(ambiguous.alignment!.status, "INCOMPLETE"); assert.equal(ambiguous.alignment!.reason, "UNINFORMATIVE_ENVELOPE");
    const identical = await measureExportedAudioTiming(params, async () => reference);
    assert.equal(identical.status, "PASS"); assert.equal(identical.rms.status, "PASS");
    assert.equal(identical.method, "STEREO_ENERGY_ENVELOPE_STREAM_V3");
    assert.equal(identical.lagQuantizationBoundsMilliseconds!.maximum, AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds);
    const delayed = stereoPcm(40_000, (frame, channel) => frame < 160 ? 0 : gains[Math.floor((frame - 160) / 40)]! * (channel ? -1 : 1));
    const delayReport = await measureExportedAudioTiming(params, async (path) => path === referencePath ? reference : delayed);
    assert.equal(delayReport.lagMilliseconds, 20); assert.equal(delayReport.alignment!.status, "INCOMPLETE");
    assert.equal(delayReport.rms.status, "FAIL", "RMS compara la misma posición, no compensa el lag encontrado");
  } finally { await rm(referencePath, { force: true }); await rm(referenceMetadataPath, { force: true }); await rmdir(directory); }
});
