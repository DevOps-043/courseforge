import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { generateVideoConformanceCorpusSource } from "../qa/composition-video-corpus-generator";
import { renderVideoCorpusFrame } from "../qa/composition-video-corpus-frames";
import { createCorpusStereoAudio } from "../qa/composition-conformance-corpus-assets";
import { extractDecodedCorpusPcm } from "../qa/composition-video-corpus-audio-evidence";

const probe = {format: {duration: "10.000"}, streams: [
  {codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "25/1"},
  {codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000"}]};
// Mock process output tests coordination/integrity only; these are not MP4 bytes,
// ffprobe execution, codec acceptance or evidence that a real fixture was generated.
const mockBytes = Buffer.from("controlled process output; not an MP4");
const frameTimes = Array.from({length: 250}, (_, index) => (index / 25).toFixed(6)).join("\n");
const mockDecode = async (_binary: string, _videoPath: string, timeSeconds: number) => renderVideoCorpusFrame(timeSeconds === 0 ? 0 : 125, 250);
const sourceAudio = createCorpusStereoAudio("VOICE").bytes;
const mockDecodedAudio = Buffer.alloc(48000 * 10 * 2 * 2);
for (let frame = 0; frame < 48000 * 10; frame++) {
  for (let channel = 0; channel < 2; channel++) {
    const sample = sourceAudio.readFloatLE(44 + (Math.floor(frame / 6) * 2 + channel) * 4);
    mockDecodedAudio.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), (frame * 2 + channel) * 2);
  }
}
const mockAudioDecode = async () => mockDecodedAudio;

async function controlledFiles() {
  const parent = await mkdtemp(join(tmpdir(), "corpus-generator-test-"));
  const ffmpegPath = join(parent, "controlled-encoder"), ffprobePath = join(parent, "controlled-probe");
  await writeFile(ffmpegPath, "controlled encoder"); await writeFile(ffprobePath, "controlled probe");
  return {params: {outputParentDirectory: parent, ffmpegPath, ffprobePath, fps: 25 as const},
    async cleanup() {await rm(ffmpegPath); await rm(ffprobePath); await rmdir(parent);}};
}

test("generator binds actual output/audio/binary hashes and recipe receipts without executing codecs", async () => {
  const state = await controlledFiles();
  let calls = 0; let result: Awaited<ReturnType<typeof generateVideoConformanceCorpusSource>> | undefined;
  try {
    result = await generateVideoConformanceCorpusSource(state.params, async (binary, args, options) => {
      calls++; assert.equal(options.windowsHide, true); assert.ok(options.timeout <= 300_000); assert.equal(options.maxBuffer, 128 * 1024);
      if (binary === state.params.ffmpegPath) {
        assert.ok(args.includes("-n")); await writeFile(args.at(-1)!, mockBytes, {flag: "wx"}); return {stdout: ""};
      }
      assert.equal(binary, state.params.ffprobePath);
      return {stdout: args.includes("-select_streams") ? frameTimes : JSON.stringify(probe)};
    }, async () => 250, mockDecode, mockAudioDecode);
    assert.equal(calls, 3);
    assert.equal(result.receipt.source.checksum, createHash("sha256").update(mockBytes).digest("hex"));
    assert.equal(result.receipt.audioSourceSha256, createHash("sha256").update(await readFile(result.audioPath)).digest("hex"));
    assert.equal(result.receipt.cases.length, 7);
    assert.equal(result.receipt.frameCount, 250);
    assert.ok(result.receipt.maxTimelineDriftFrames < 0.001);
    assert.equal(result.receipt.decodedFrames.length, 2);
    assert.notEqual(result.receipt.decodedFrames[0]!.pngSha256, result.receipt.decodedFrames[1]!.pngSha256);
    assert.notEqual(result.receipt.decodedFrames[0]!.pixelSha256, result.receipt.decodedFrames[1]!.pixelSha256);
    assert.equal(result.receipt.decodedAudio.decodedFrames, 480000);
    assert.equal(result.receipt.decodedAudio.measuredWindowCount, 20);
    assert.ok(result.receipt.decodedAudio.maximumRmsDeltaDb < 0.1);
    assert.equal(result.receipt.scope, "LOCAL_ENCODING_AND_PROBE_NOT_RENDER_PARITY");
    assert.deepEqual(JSON.parse(await readFile(result.receiptPath, "utf8")), result.receipt);
    assert.equal(JSON.stringify(result.receipt).includes(state.params.outputParentDirectory), false);
  } finally {
    if (result) {
      for (const path of [result.videoPath, result.audioPath, result.receiptPath]) await rm(path);
      await rmdir(result.directory);
    }
    await state.cleanup();
  }
});

test("probe failures and video/binary mutation reject the artifact and clean only owned files", async () => {
  for (const failure of ["encoder", "probe", "audio", "dimensions", "fps", "duration", "channels", "frames-count", "frames-drift", "decode", "static-video", "static-video-reencoded",
    "audio-decode", "silent-audio", "truncated-audio", "wrong-audio-envelope",
    "video-change", "binary-change", "source-audio-change"] as const) {
    const state = await controlledFiles();
    try {
      await assert.rejects(generateVideoConformanceCorpusSource(state.params, async (binary, args) => {
        if (binary === state.params.ffmpegPath) {
          if (failure === "encoder") throw new Error("private path https://signed.example?token=secret");
          await writeFile(args.at(-1)!, mockBytes, {flag: "wx"}); return {stdout: ""};
        }
        if (args.includes("-select_streams")) {
          if (failure === "frames-count") return {stdout: frameTimes.split("\n").slice(0, -1).join("\n")};
          if (failure === "frames-drift") return {stdout: frameTimes.replace("0.040000", "0.080000")};
          return {stdout: frameTimes};
        }
        if (failure === "probe") return {stdout: "invalid sensitive JSON"};
        const changed = structuredClone(probe);
        if (failure === "audio") changed.streams.pop();
        if (failure === "dimensions") changed.streams[0]!.width = 1280;
        if (failure === "fps") changed.streams[0]!.avg_frame_rate = "30/1";
        if (failure === "duration") changed.format.duration = "8";
        if (failure === "channels") changed.streams[1]!.channels = 1;
        if (failure === "video-change") await writeFile(args.at(-1)!, "changed output");
        if (failure === "binary-change") await writeFile(state.params.ffmpegPath, "changed encoder");
        if (failure === "source-audio-change") await writeFile(join(dirname(args.at(-1)!), "source.wav"), "changed source");
        return {stdout: JSON.stringify(changed)};
      }, async () => 250, failure === "decode" ? async () => {throw new Error("private decoder details");}
        : failure === "static-video" ? async () => renderVideoCorpusFrame(0, 250)
        : failure === "static-video-reencoded" ? async (_binary, _path, timeSeconds) =>
          sharp(await renderVideoCorpusFrame(0, 250)).png({compressionLevel: timeSeconds === 0 ? 0 : 9}).toBuffer()
        : mockDecode, failure === "audio-decode" ? async () => {throw new Error("private decoder details");}
        : failure === "silent-audio" ? async () => Buffer.alloc(mockDecodedAudio.length)
        : failure === "truncated-audio" ? async () => mockDecodedAudio.subarray(0, mockDecodedAudio.length / 2)
        : failure === "wrong-audio-envelope" ? async () => {
          const altered = Buffer.from(mockDecodedAudio);
          for (let offset = 0; offset < altered.length; offset += 2)
            altered.writeInt16LE(Math.round(altered.readInt16LE(offset) / 4), offset);
          return altered;
        }
        : mockAudioDecode), /^Error: CONFORMANCE_CORPUS_[A-Z_]+$/);
      assert.deepEqual((await readdir(state.params.outputParentDirectory)).sort(), ["controlled-encoder", "controlled-probe"]);
    } finally {await state.cleanup();}
  }
});

test("WAV pipe decoder accepts bounded PCM chunks and rejects malformed stream metadata", () => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(0xffffffff, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(0xffffffff, 40);
  const wav = Buffer.concat([header, mockDecodedAudio]);
  assert.deepEqual(extractDecodedCorpusPcm(wav), mockDecodedAudio);
  const wrongRate = Buffer.from(wav); wrongRate.writeUInt32LE(44100, 24);
  assert.throws(() => extractDecodedCorpusPcm(wrongRate), /CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID/);
  assert.throws(() => extractDecodedCorpusPcm(wav.subarray(0, 43)), /CONFORMANCE_CORPUS_AUDIO_FORMAT_INVALID/);
});

test("cleanup never recursively deletes an unexpected file left by a stage", async () => {
  const state = await controlledFiles(); let stageDirectory = "";
  try {
    await assert.rejects(generateVideoConformanceCorpusSource(state.params, async (_binary, args) => {
      stageDirectory = dirname(args.at(-1)!);
      await writeFile(join(stageDirectory, "unexpected-stage-file"), "preserve for inspection", {flag: "wx"});
      throw new Error("controlled encoder failure");
    }, async () => 250, mockDecode, mockAudioDecode), /CONFORMANCE_CORPUS_CLEANUP_FAILED/);
    assert.deepEqual(await readdir(stageDirectory), ["unexpected-stage-file"]);
    assert.equal(await readFile(join(stageDirectory, "unexpected-stage-file"), "utf8"), "preserve for inspection");
  } finally {
    if (stageDirectory) {await rm(join(stageDirectory, "unexpected-stage-file")); await rmdir(stageDirectory);}
    await state.cleanup();
  }
});

test("cancellation after encoding prevents probing/receipt and cleans partial output", async () => {
  const state = await controlledFiles(), controller = new AbortController(); let calls = 0;
  try {
    await assert.rejects(generateVideoConformanceCorpusSource({...state.params, signal: controller.signal}, async (_binary, args) => {
      calls++; await writeFile(args.at(-1)!, mockBytes, {flag: "wx"}); controller.abort("private reason"); return {stdout: ""};
    }, async () => 250, mockDecode, mockAudioDecode), /CONFORMANCE_CORPUS_ABORTED/);
    assert.equal(calls, 1);
    assert.deepEqual((await readdir(state.params.outputParentDirectory)).sort(), ["controlled-encoder", "controlled-probe"]);
  } finally {await state.cleanup();}
});

test("authored video frames vary by index without system fonts or remote media", async () => {
  const first = await renderVideoCorpusFrame(0, 250);
  const next = await renderVideoCorpusFrame(1, 250);
  assert.ok(first.length > 0 && next.length > 0);
  assert.notEqual(createHash("sha256").update(first).digest("hex"), createHash("sha256").update(next).digest("hex"));
  await assert.rejects(renderVideoCorpusFrame(250, 250), /FRAME_INDEX_INVALID/);
});
