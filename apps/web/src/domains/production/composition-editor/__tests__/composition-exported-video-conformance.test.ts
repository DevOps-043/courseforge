import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { RenderInternals } from "@remotion/renderer";
import sharp from "sharp";
import { COMPOSITION_CONFORMANCE_THRESHOLDS } from "../composition-preview-render-conformance";
import { parseExportedAudioSignal } from "../qa/composition-exported-audio-signal";
import {
  compareExportedVideoWithPreview,
  evaluateExportedAudioPresence,
  exportedVideoReceiptSchema,
  parseExportedFrameTimes,
  parseExportedVideoProbe,
} from "../qa/composition-exported-video-conformance";

const runFile = promisify(execFile);

test("lee dimensiones, FPS y duración de un MP4", () => {
  assert.deepEqual(parseExportedVideoProbe({
    format: { duration: "2.000000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "25/1" },
      { codec_type: "audio" },
    ],
  }), { colorTags: {matrix: null, primaries: null, transfer: null, range: null}, codec: "h264", durationSeconds: 2, fps: 25, hasAudio: true, height: 1080, width: 1920 });
  assert.throws(() => parseExportedVideoProbe({ format: { duration: "2" }, streams: [{ codec_type: "video", width: 1, height: 1, avg_frame_rate: "0/0" }] }), /EXPORTED_VIDEO_TIMING_INVALID/);
  assert.equal(evaluateExportedAudioPresence(true, false), "MISSING_REQUIRED_TRACK");
  assert.equal(evaluateExportedAudioPresence(true, true), "TRACK_PRESENT_NEEDS_SIGNAL_CHECK");
  assert.equal(evaluateExportedAudioPresence(false, false), "NOT_REQUIRED");
  assert.equal(evaluateExportedAudioPresence(undefined, false), "EXPECTATION_UNKNOWN");
});

test("mide señal de audio sin confundir sample peak con true peak", () => {
  const prefix = "[Parsed_volumedetect_0 @ 00000001]";
  assert.deepEqual(parseExportedAudioSignal(`${prefix} mean_volume: -18.2 dB\n${prefix} max_volume: -2.1 dB`), {
    maxDbfs: -2.1, meanDbfs: -18.2, signalAboveFloor: true,
  });
  assert.deepEqual(parseExportedAudioSignal(`${prefix} mean_volume: -inf dB\n${prefix} max_volume: -inf dB`), {
    maxDbfs: null, meanDbfs: null, signalAboveFloor: false,
  });
  assert.equal(parseExportedAudioSignal(`${prefix} mean_volume: -80.0 dB\n${prefix} max_volume: -61.0 dB`).signalAboveFloor, false);
  assert.throws(() => parseExportedAudioSignal(`${prefix} mean_volume: -2 dB\n${prefix} max_volume: -18 dB`), /EXPORTED_VIDEO_AUDIO_MEASUREMENT_INVALID/);
  assert.throws(() => parseExportedAudioSignal("max_volume: -1.0 dB"), /EXPORTED_VIDEO_AUDIO_MEASUREMENT_MISSING/);
});

test("requiere evidencia temporal completa y recibo ligado al archivo", () => {
  const timeline = { expectedFrameCount: 3, fps: 25, maxTemporalDriftFrames: 0.5 };
  assert.deepEqual(parseExportedFrameTimes("0.000000,\n0.040000\n0.080000", [0, 2], timeline), {
    checkpointTimes: [0, 0.08], frameCount: 3, maxTimelineDriftFrames: 0,
  });
  assert.throws(() => parseExportedFrameTimes("0.000000", [0, 2]), /EXPORTED_VIDEO_FRAMES_INCOMPLETE/);
  assert.throws(() => parseExportedFrameTimes("0.000000", [0, 0]), /EXPORTED_VIDEO_FRAMES_INCOMPLETE/);
  assert.throws(() => parseExportedFrameTimes("0.000000\n0.040000", [0, 1], timeline), /EXPORTED_VIDEO_FRAME_COUNT_MISMATCH/);
  assert.throws(() => parseExportedFrameTimes("0.000000\n0.040000\n0.040000", [0, 2], timeline), /EXPORTED_VIDEO_FRAME_TIMESTAMPS_INVALID/);
  assert.throws(() => parseExportedFrameTimes("0.000000\n0.064000\n0.080000", [0, 2], timeline), /EXPORTED_VIDEO_TIMELINE_DRIFT/);
  assert.throws(() => parseExportedFrameTimes("0.000000\nN/A\n0.080000", [0, 2], timeline), /EXPORTED_VIDEO_FRAMES_INCOMPLETE/);
  assert.equal(exportedVideoReceiptSchema.safeParse({ documentHash: "a".repeat(64), videoSha256: "b".repeat(64) }).success, true);
  assert.equal(exportedVideoReceiptSchema.safeParse({ documentHash: "a".repeat(64), videoSha256: "b".repeat(64), untrusted: true }).success, false);
});

test("compara un MP4 local y detecta corrupción visual y recibo incorrecto", async () => {
  const directory = await mkdtemp(join(tmpdir(), "courseforge-export-test-"));
  const ffmpeg = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  const videoPath = join(directory, "export.mp4");
  const sourceDirectory = join(directory, "source");
  const previewDirectory = join(directory, "preview");
  const contractPath = join(directory, "contract.json");
  const metadataPath = join(directory, "preview-metadata.json");
  const receiptPath = join(directory, "receipt.json");
  const documentHash = "a".repeat(64);
  try {
    await mkdir(previewDirectory);
    await mkdir(sourceDirectory);
    const redFrame = await sharp({ create: { width: 160, height: 90, channels: 3, background: "#ff0000" } }).png().toBuffer();
    await Promise.all(Array.from({ length: 50 }, (_, frameIndex) => writeFile(join(sourceDirectory, `frame-${String(frameIndex).padStart(3, "0")}.png`), redFrame)));
    await runFile(ffmpeg, ["-hide_banner", "-loglevel", "error", "-framerate", "25", "-i", join(sourceDirectory, "frame-%03d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", videoPath], { timeout: 30_000 });
    const videoSha256 = createHash("sha256").update(await readFile(videoPath)).digest("hex");
    await writeFile(receiptPath, JSON.stringify({ documentHash, videoSha256 }));
    const checkpoints = [0, 25, 49].map((frameIndex) => ({ frameIndex, reasons: ["synthetic-test"], timeSeconds: frameIndex / 25 }));
    await writeFile(contractPath, JSON.stringify({
      assets: [], canvas: { durationSeconds: 2, fps: 25, height: 90, width: 160 }, checkpoints,
      compilerContract: "courseforge-composition-preview-compiler-v1", documentHash,
      renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
      schemaVersion: 1, thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS,
    }));
    await writeFile(metadataPath, JSON.stringify({ documentHash, frames: checkpoints.map(({ frameIndex, timeSeconds }) => ({ frameIndex, timeSeconds })) }));
    for (const checkpoint of checkpoints) {
      await runFile(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", videoPath, "-ss", String(checkpoint.timeSeconds), "-frames:v", "1", join(previewDirectory, `frame-${checkpoint.frameIndex}.png`)], { timeout: 30_000 });
    }
    const input = { contractPath, previewDirectory, previewMetadataPath: metadataPath, renderReceiptPath: receiptPath, videoPath };
    const passing = await compareExportedVideoWithPreview(input);
    assert.equal(passing.status, "INCOMPLETE");
    assert.equal(passing.visual.checkedCheckpointCount, 3);
    assert.equal(passing.video.frameCount, 50);
    assert.equal(passing.provenance, "LOCAL_RECEIPT_NOT_AUTHENTICATED");
    assert.equal(passing.audioStatus, "EXPECTATION_UNKNOWN");
    const contract = JSON.parse(await readFile(contractPath, "utf8")) as Record<string, unknown>;
    await writeFile(contractPath, JSON.stringify({ ...contract, audio: { required: true }, schemaVersion: 2 }));
    const missingAudio = await compareExportedVideoWithPreview(input);
    assert.equal(missingAudio.visual.status, "PASS");
    assert.equal(missingAudio.status, "FAIL");
    assert.equal(missingAudio.audioStatus, "MISSING_REQUIRED_TRACK");
    await writeFile(contractPath, JSON.stringify(contract));
    await sharp({ create: { width: 160, height: 90, channels: 3, background: "#00ff00" } }).png().toFile(join(previewDirectory, "corrupt.png"));
    await copyFile(join(previewDirectory, "corrupt.png"), join(previewDirectory, "frame-25.png"));
    assert.equal((await compareExportedVideoWithPreview(input)).status, "FAIL");
    await writeFile(receiptPath, JSON.stringify({ documentHash, videoSha256: "b".repeat(64) }));
    await assert.rejects(compareExportedVideoWithPreview(input), /EXPORTED_VIDEO_RECEIPT_HASH_MISMATCH/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
