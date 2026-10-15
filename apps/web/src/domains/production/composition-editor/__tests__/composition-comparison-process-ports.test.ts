import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, mkdir, rm, stat} from "node:fs/promises";
import {join, dirname} from "node:path";
import {tmpdir} from "node:os";
import sharp from "sharp";
import {compareExportedVideoWithPreview} from "../qa/composition-exported-video-conformance";
import {measureExportedAudioLoudness} from "../qa/composition-exported-audio-loudness";
import type {ComparisonProcessPorts} from "../qa/composition-comparison-process-ports";
import {COMPOSITION_CONFORMANCE_THRESHOLDS} from "../composition-preview-render-conformance";

test("partial process configuration rejects before file reads or native fallback", async () => {
  await assert.rejects(compareExportedVideoWithPreview({contractPath: "unused", previewDirectory: "unused",
    previewMetadataPath: "unused", renderReceiptPath: "unused", videoPath: "unused",
    processPorts: {pixelDecoderPath: "relative", probePath: "relative"} as ComparisonProcessPorts}),
  /PROCESS_CONFIGURATION_INVALID/);
});

test("export comparison routes probe and frame decode to host ports, preserving real pixel measurement", async t => {
  const directory = await mkdtemp(join(tmpdir(), "cf-comparison-ports-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const previewDirectory = join(directory, "preview"); await mkdir(previewDirectory);
  const frame = await sharp({create: {width: 4, height: 4, channels: 3, background: "red"}}).png().toBuffer();
  await writeFile(join(previewDirectory, "frame-0.png"), frame);
  const videoPath = join(directory, "video.mp4"); await writeFile(videoPath, "fixture, not a video");
  const documentHash = "a".repeat(64), videoSha256 = createHash("sha256").update("fixture, not a video").digest("hex");
  const contractPath = join(directory, "contract.json"), renderReceiptPath = join(directory, "receipt.json"),
    previewMetadataPath = join(directory, "metadata.json"), pixelDecoderPath = join(directory, "decoder.exe"), probePath = join(directory, "probe.exe");
  await writeFile(pixelDecoderPath, "fixture decoder"); await writeFile(probePath, "fixture probe");
  await writeFile(contractPath, JSON.stringify({assets: [], canvas: {durationSeconds: 1 / 30, fps: 30, height: 4, width: 4},
    checkpoints: [{frameIndex: 0, reasons: ["fixture"], timeSeconds: 0}], compilerContract: "courseforge-composition-preview-compiler-v1",
    documentHash, renderProfile: {format: "mp4", fps: 30, quality: "high", resolution: "1080p"}, schemaVersion: 1,
    thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS}));
  await writeFile(renderReceiptPath, JSON.stringify({documentHash, videoSha256}));
  await writeFile(previewMetadataPath, JSON.stringify({documentHash, frames: [{frameIndex: 0, timeSeconds: 0}]}));
  const calls: string[] = [];
  const processPorts: ComparisonProcessPorts = {pixelDecoderPath, probePath,
    consumePcm: async () => {throw new Error("No audio expected");},
    execute: async (binary, arguments_, options) => {
      calls.push(binary); assert.equal(options.env.NODE_OPTIONS, undefined);
      if (binary === probePath) return {stderr: "", stdout: arguments_.includes("csv=p=0") ? "0\n" : JSON.stringify({
        format: {duration: String(1 / 30)}, streams: [{codec_type: "video", codec_name: "h264", width: 4, height: 4, avg_frame_rate: "30/1"}]})};
      assert.equal(binary, pixelDecoderPath); await writeFile(arguments_.at(-1)!, frame); return {stdout: "", stderr: ""};
    }};
  const report = await compareExportedVideoWithPreview({contractPath, previewDirectory, previewMetadataPath,
    renderReceiptPath, videoPath, processPorts});
  assert.deepEqual(calls, [probePath, probePath, pixelDecoderPath]);
  assert.equal(report.visual.checkedCheckpointCount, 1); assert.equal(report.video.sha256, videoSha256);
  assert.equal(report.status, "INCOMPLETE"); // No original-session, audio expectation, or provenance evidence invented.
  const previousExecute = processPorts.execute;
  let retainedDirectory: string | undefined;
  processPorts.execute = async (binary, arguments_, options) => {
    if (binary === pixelDecoderPath) {
      retainedDirectory = dirname(arguments_.at(-1)!);
      throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");
    }
    return previousExecute(binary, arguments_, options);
  };
  await assert.rejects(compareExportedVideoWithPreview({contractPath, previewDirectory, previewMetadataPath,
    renderReceiptPath, videoPath, processPorts}), {message: "CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED"});
  assert.ok(retainedDirectory?.startsWith(join(tmpdir(), "courseforge-export-conformance-")));
  assert.equal((await stat(retainedDirectory!)).isDirectory(), true);
  // Fixture-only cleanup: no process was created; production must preserve this directory for intervention.
  await rm(retainedDirectory!, {recursive: true, force: true});
});

test("audio analysis propagates unknown owned termination instead of continuing measurements", async () => {
  await assert.rejects(measureExportedAudioLoudness({ffmpegPath: "unused", videoPath: "unused",
    execute: async () => {throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");}}),
  {message: "CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED"});
});
