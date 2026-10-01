import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalizeBrowserPlaybackAudio } from "../qa/composition-playback-audio-canonicalization";
import { stereoFloatWavHeader } from "../qa/composition-pcm-wav";
import { PLAYBACK_CAPTURE_POLICY } from "../qa/composition-playback-capture-runtime";
import { evaluatePlaybackAudioWitness } from "../qa/composition-playback-audio-gate";
import { audioTimingReport } from "../qa/composition-exported-audio-timing";
import { playbackVisualFramesHash } from "../qa/composition-playback-audio-contract";
import { createMaterializedPlaybackAudioReference } from "../qa/composition-materialized-playback-audio";
import { COMPOSITION_CONFORMANCE_THRESHOLDS } from "../composition-preview-render-conformance";
import { playbackBoundaryFixture } from "./composition-playback-test-fixtures";

function pcm(frames: number) {const bytes = Buffer.alloc(frames * 8); for (let offset = 0; offset < bytes.length; offset += 4) bytes.writeFloatLE(0.25, offset); return bytes;}
const witness = {policy: PLAYBACK_CAPTURE_POLICY.id, workletSha256: "c".repeat(64), originFrame: 0, sampleCount: 1440,
  packetCount: 12, eventCount: 4, maxClockDriftMilliseconds: 2, maxMediaDriftMilliseconds: 2, quantumMilliseconds: 128000 / 48000,
  observation: "BROWSER_MEDIA_GRAPH_NOT_PHYSICAL_DEVICE_OR_SEMANTIC_LIP_SYNC" as const, boundaries: playbackBoundaryFixture(0.03)};
async function fixture(run: (params: Parameters<typeof canonicalizeBrowserPlaybackAudio>[0], pcmBytes: Buffer) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "canonical-playback-test-")); const path = join(root, "native.wav");
  const bytes = Buffer.concat([stereoFloatWavHeader(1440 * 8, 48000), pcm(1440)]);
  await writeFile(path, bytes);
  const receipt = {schemaVersion: 3, method: "BROWSER_MEDIA_OUTPUT_PCM_V3", status: "BROWSER_PLAYBACK_CAPTURED",
    organizationId: "70000000-0000-4000-8000-000000000001", revisionId: "70000000-0000-4000-8000-000000000001",
    projectHash: "a".repeat(64), documentHash: "b".repeat(64), assetCount: 1, mediaBytes: 100, audioEnvelopeVersion: 2,
    durationSeconds: 0.03, sampleRate: 48000, channels: 2, audioSha256: createHash("sha256").update(bytes).digest("hex"),
    peak: 0.25, clipCount: 1, decodedAssetCount: 0, playback: witness};
  try {await run({nativePath: path, receipt, outputParentDirectory: root, ffmpegPath: "controlled"}, pcm(240));}
  finally {await rm(path); assert.deepEqual(await readdir(root), []); await rmdir(root);}
}

test("conversión native48k→8k usa argv file-only y stdout incremental, SHA y limpieza", async () => {
  await fixture(async (params, bytes) => {
    const reference = await canonicalizeBrowserPlaybackAudio(params, async (decode) => {
      assert.equal(decode.maximumBytes, bytes.length); assert.ok(decode.arguments.includes("file,pipe"));
      assert.ok(decode.arguments.includes("aresample=8000:async=1:first_pts=0"));
      for (let offset = 0; offset < bytes.length; offset += 7) await decode.consume(bytes.subarray(offset, offset + 7));
    });
    try {
      const wav = await readFile(reference.audioReferencePath);
      assert.equal(wav.readUInt32LE(24), 8000); assert.ok(wav.subarray(44).equals(bytes));
      assert.equal(reference.receipt.sampleRate, 8000); assert.equal(reference.receipt.native.sampleRate, 48000);
      assert.equal(reference.receipt.method, "BROWSER_MEDIA_OUTPUT_PCM_CANONICAL_V3");
      assert.equal(reference.receipt.audioSha256, createHash("sha256").update(wav).digest("hex"));
    } finally {await reference.cleanup(); await reference.cleanup();}
  });
});
test("hueco de muestras, cola truncada, NaN, clipping y decoder fallido no se normalizan/rellenan", async () => {
  for (const mode of ["short", "tail", "NaN", "clip", "failure", "long"]) {
    await fixture(async (params, expected) => {
      await assert.rejects(canonicalizeBrowserPlaybackAudio(params, async (decode) => {
        if (mode === "failure") throw new Error("controlled");
        const bytes = mode === "short" ? expected.subarray(0, -8) : mode === "tail" ? expected.subarray(0, -1)
          : mode === "long" ? Buffer.concat([expected, pcm(1)]) : Buffer.from(expected);
        if (mode === "NaN") bytes.writeFloatLE(NaN, 0); if (mode === "clip") bytes.writeFloatLE(1.1, 0);
        await decode.consume(bytes);
      }));
    });
  }
});
test("captura nativa alterada antes/durante decoding y recibo de samples falso se rechazan", async () => {
  for (const mode of ["before", "during", "receipt"]) {
    await fixture(async (params, bytes) => {
      if (mode === "before") await writeFile(params.nativePath, "altered");
      if (mode === "receipt") params.receipt = {...params.receipt as object, playback: {...witness, sampleCount: 1441}};
      let decoded = false;
      await assert.rejects(canonicalizeBrowserPlaybackAudio(params, async (decode) => {
        decoded = true; await decode.consume(bytes); if (mode === "during") await writeFile(params.nativePath, "altered");
      }));
      assert.equal(decoded, mode === "during");
    });
  }
});
test("header conserva límites independientes 8k y48k, sin permitir perfiles arbitrarios", () => {
  for (const rate of [8000, 48000] as const) {
    const size = rate * 600 * 8;
    assert.equal(stereoFloatWavHeader(size, rate).readUInt32LE(40), size);
    assert.throws(() => stereoFloatWavHeader(size + 8, rate));
  }
  assert.throws(() => stereoFloatWavHeader(8, 44100 as 48000));
});
test("coordinador enlaza frames de la misma sesión y limpia captura/canónico incluso en fallo", async () => {
  for (const fail of [false, true]) await fixture(async (params, bytes) => {
    const contractPath = join(params.outputParentDirectory, "conformance-contract.json");
    await writeFile(contractPath, JSON.stringify({schemaVersion: 1, documentHash: "b".repeat(64), assets: [],
      compilerContract: "courseforge-composition-preview-compiler-v1", canvas: {durationSeconds: 0.03, width: 1920, height: 1080, fps: 25},
      checkpoints: [{frameIndex: 0, timeSeconds: 0, reasons: ["start"]}], thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS,
      renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}}));
    let captureCleaned = false;
    const frames = [{frameIndex: 0, timeSeconds: 0, sha256: "f".repeat(64), sizeBytes: 100}];
    const dependencies = {capture: async (input: {capturePlaybackAudio?: boolean}) => {
      assert.equal(input.capturePlaybackAudio, true);
      return {receipt: {frames}, playback: {receipt: params.receipt, audioReferencePath: params.nativePath}, cleanup: async () => {captureCleaned = true;}};
    }, canonicalize: async (input: Parameters<typeof canonicalizeBrowserPlaybackAudio>[0]) => {
      if (fail) throw new Error("controlled");
      return canonicalizeBrowserPlaybackAudio(input, async (decode) => {await decode.consume(bytes);});
    }} as never;
    try {
      const action = createMaterializedPlaybackAudioReference({materialized: {directory: params.outputParentDirectory} as never,
        outputParentDirectory: params.outputParentDirectory, ffmpegPath: "controlled"}, dependencies);
      if (fail) await assert.rejects(action);
      else {const result = await action; assert.equal(result.receipt.visualFramesSha256, playbackVisualFramesHash(frames)); await result.cleanup();}
      assert.equal(captureCleaned, true);
    } finally {await rm(contractPath);}
  });
});
test("gate A/V combina lag, deriva y quantum; límites inciertos no producen PASS", () => {
  const timing = {...audioTimingReport("PASS"), lagMilliseconds: 0};
  assert.equal(evaluatePlaybackAudioWitness(witness, timing, 25, 1).status, "PASS");
  assert.equal(evaluatePlaybackAudioWitness({...witness, maxClockDriftMilliseconds: 15}, timing, 25, 1).status, "INCOMPLETE");
  assert.equal(evaluatePlaybackAudioWitness({...witness, maxClockDriftMilliseconds: 40}, timing, 25, 1).status, "FAIL");
  assert.equal(evaluatePlaybackAudioWitness({...witness, maxMediaDriftMilliseconds: 16}, timing, 60, 1).status, "INCOMPLETE");
  assert.equal(evaluatePlaybackAudioWitness({...witness, eventCount: 0}, timing, 25, 1).status, "INCOMPLETE");
  assert.equal(evaluatePlaybackAudioWitness(witness, audioTimingReport("INCOMPLETE"), 25, 1).status, "INCOMPLETE");
});
test("pin visual ignora orden JSON de claves/frames, pero nunca diferencias de píxeles/timing", () => {
  const first = [{frameIndex: 1, timeSeconds: 0.04, sha256: "a".repeat(64), sizeBytes: 10}, {frameIndex: 0, timeSeconds: 0, sha256: "b".repeat(64), sizeBytes: 11}];
  const reordered = first.toReversed().map(({frameIndex, timeSeconds, sha256, sizeBytes}) => ({sizeBytes, sha256, timeSeconds, frameIndex}));
  assert.equal(playbackVisualFramesHash(first), playbackVisualFramesHash(reordered));
  assert.notEqual(playbackVisualFramesHash(first), playbackVisualFramesHash([{...first[0]!, sha256: "c".repeat(64)}, first[1]!]));
});
