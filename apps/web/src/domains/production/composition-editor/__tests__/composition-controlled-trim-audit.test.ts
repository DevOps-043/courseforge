import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {auditControlledTrimRender} from "../qa/composition-controlled-trim-audit";
import {renderVideoCorpusFrame} from "../qa/composition-video-corpus-frames";

async function fixture(run: (input: Parameters<typeof auditControlledTrimRender>[0],
  decode: Parameters<typeof auditControlledTrimRender>[1], mode: {value: string}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "trim-audit-test-"));
  const paths = ["video.fixture", "source.fixture", "decoder.fixture"].map(name => join(directory, name));
  const bytes = "synthetic bytes, no encoded video";
  const hash = createHash("sha256").update(bytes).digest("hex");
  const input = {fps: 25 as const, videoPath: paths[0]!, sourcePath: paths[1]!, ffmpegPath: paths[2]!,
    videoSha256: hash, sourceSha256: hash, ffmpegSha256: hash};
  const mode = {value: "success"};
  const blank = await sharp({create: {width: 1920, height: 1080, channels: 3, background: "#020617"}}).png().toBuffer();
  const frames = new Map<number, Buffer>();
  const source = Buffer.alloc(4 * 48000 * 2 * 4), rendered = Buffer.alloc(8 * 48000 * 2 * 4);
  for (let frame = 0; frame < 4 * 48000; frame++) for (let channel = 0; channel < 2; channel++) {
    const sample = channel === 0 ? 0.1 : 0.2;
    source.writeFloatLE(sample, (frame * 2 + channel) * 4);
    rendered.writeFloatLE(sample * 0.8, ((frame + 48000) * 2 + channel) * 4);
  }
  const decode: NonNullable<Parameters<typeof auditControlledTrimRender>[1]> = async (_binary, args, options) => {
    assert.equal(options.env.NODE_OPTIONS, undefined);
    const start = Number(args[args.indexOf("-ss") + 1]);
    if (args.includes("png")) {
      const frameIndex = Math.round(start * input.fps);
      if (start < 1 || start >= 5) return {stdout: mode.value === "imageLeak" ? await renderVideoCorpusFrame(input.fps, input.fps * 10) : blank};
      const sourceFrame = input.fps + frameIndex + (mode.value === "offset" ? 1 : 0);
      if (!frames.has(sourceFrame)) frames.set(sourceFrame, await renderVideoCorpusFrame(sourceFrame, input.fps * 10));
      return {stdout: frames.get(sourceFrame)!};
    }
    const isSource = args[args.indexOf("-i") + 1] === input.sourcePath;
    assert.equal(start, isSource ? 2 : 0);
    assert.equal(args[args.indexOf("-t") + 1], isSource ? "4" : "8");
    const result = Buffer.from(isSource ? source : rendered);
    if (!isSource && mode.value === "gain") result.fill(0);
    if (!isSource && mode.value === "wrongGain") for (let offset = 48000 * 2 * 4; offset < 5 * 48000 * 2 * 4; offset += 4)
      result.writeFloatLE(result.readFloatLE(offset) * 0.5, offset);
    if (!isSource && mode.value === "audioLeak") for (let offset = 0; offset < 48000 * 2 * 4; offset += 4) result.writeFloatLE(0.1, offset);
    if (!isSource && mode.value === "briefLeak") for (let frame = 24000; frame < 24048; frame++)
      result.writeFloatLE(0.01, frame * 2 * 4);
    if (!isSource && mode.value === "nan") result.writeFloatLE(NaN, 0);
    return {stdout: result};
  };
  try {for (const path of paths) await writeFile(path, bytes); await run(input, decode, mode);}
  finally {for (const path of paths) await rm(path, {force: true}); await rmdir(directory);}
}
test("trim audit measures both video boundaries, source offset and stereo gain/silence", async () => {
  await fixture(async (input, decode) => {
    const result = await auditControlledTrimRender(input, decode);
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.frames.map(frame => frame.frameIndex), [0, 24, 25, 26, 75, 124, 125, 126, 199]);
    assert.deepEqual(result.frames.filter(frame => frame.visible).map(frame => frame.sourceFrame), [50, 51, 100, 149]);
    assert.ok(result.audio.maximumRmsDeltaDb < 0.001);
    assert.equal(result.audio.maximumSilentRms, 0);
    assert.equal(result.audio.windowCount, 16);
    assert.equal(result.audio.silenceWindowCount, 792);
    assert.equal(result.audio.silenceWindowSeconds, 0.02);
    assert.equal(result.audio.silenceHopSeconds, 0.01);
    assert.equal(JSON.stringify(result).includes(input.videoPath), false);
  });
});
test("trim boundary expectations stay on-grid at all four corpus frame rates", async () => {
  await fixture(async (input, decode) => {
    for (const fps of [24, 25, 30, 60] as const) {
      input.fps = fps;
      const result = await auditControlledTrimRender(input, decode);
      assert.deepEqual(result.frames.filter(frame => frame.visible).map(frame => frame.sourceFrame),
        [2 * fps, 2 * fps + 1, 4 * fps, 6 * fps - 1]);
      assert.ok(result.frames.some(frame => frame.frameIndex === fps - 1 && !frame.visible));
      assert.ok(result.frames.some(frame => frame.frameIndex === 5 * fps && !frame.visible));
    }
  });
});
test("trim rejects wrong source offset and image/audio leaking outside the clip", async () => {
  await fixture(async (input, decode, mode) => {
    for (const [kind, error] of [["offset", /SOURCE_TIME_MISMATCH/], ["imageLeak", /OUTSIDE_IMAGE_PRESENT/],
      ["gain", /AUDIO_SIGNAL_MISSING/], ["wrongGain", /AUDIO_GAIN_MISMATCH/],
      ["audioLeak", /OUTSIDE_AUDIO_PRESENT/], ["nan", /AUDIO_INVALID/]] as const) {
      mode.value = kind;
      await assert.rejects(auditControlledTrimRender(input, decode), error);
    }
  });
});
test("trim rejects foreign hashes and late cancellation without publishing diagnostics", async () => {
  await fixture(async (input, decode) => {
    await assert.rejects(auditControlledTrimRender({...input, videoSha256: "a".repeat(64)}, decode), /HASH_MISMATCH/);
    const abort = new AbortController();
    await assert.rejects(auditControlledTrimRender({...input, signal: abort.signal}, async (...args) => {
      const result = await decode!(...args); abort.abort("private reason"); return result;
    }), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
    await assert.rejects(auditControlledTrimRender(input, async () => {throw new Error("private path");}),
      /^Error: CONTROLLED_RENDER_TRIM_DECODE_FAILED$/);
  });
});
test("a brief mono leak cannot disappear in the RMS average of a long silence interval", async () => {
  await fixture(async (input, decode, mode) => {
    mode.value = "briefLeak";
    await assert.rejects(auditControlledTrimRender(input, decode), /OUTSIDE_AUDIO_PRESENT/);
  });
});
