import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, writeFile, readdir, rm, rmdir, stat} from "node:fs/promises";
import sharp from "sharp";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {buildSdrFrameEncoderArguments, encodeSdrCapturedFrames, SDR_FRAME_CONVERSION_POLICY} from "../qa/composition-sdr-frame-encoder";

const profile = {captureProfile: "OPAQUE_SRGB_RGB_PNG" as const, width: 1920, height: 1080, fps: 25 as const, frameCount: 200};
const fixtureProfile = {...profile, width: 16, height: 16, frameCount: 2};
async function mockProbe(path: string) {
  return {stdout: JSON.stringify({streams: [{codec_type: "video", codec_name: "h264", width: 16, height: 16,
    pix_fmt: "yuv420p", avg_frame_rate: "25/1", nb_read_frames: "2", color_space: "bt709", color_transfer: "bt709",
    color_primaries: "bt709", color_range: "tv", chroma_location: "left", start_time: "0"}],
    format: {duration: "0.08", size: String((await stat(path)).size), format_name: "mov,mp4", start_time: "0"}})};
}
test("encoder declares actual transfer/matrix/range and inverse comparison rather than metadata alone", () => {
  const args = buildSdrFrameEncoderArguments({...profile, framesDirectory: "frames with spaces", outputPath: "new video.mp4"});
  assert.equal(args[args.indexOf("-vf") + 1], SDR_FRAME_CONVERSION_POLICY.encodeFilter);
  for (const option of ["transferin=iec61966-2-1", "transfer=709", "matrixin=gbr", "matrix=709", "range=limited", "agamma=0"])
    assert.ok(SDR_FRAME_CONVERSION_POLICY.encodeFilter.includes(option));
  assert.ok(SDR_FRAME_CONVERSION_POLICY.compareFilter.includes("transferin=709"));
  assert.ok(SDR_FRAME_CONVERSION_POLICY.compareFilter.includes("transfer=iec61966-2-1"));
  assert.ok(args.includes("-n")); assert.ok(!args.includes("-y"));
  assert.equal(args[args.indexOf("-frames:v") + 1], "200");
});
test("unknown profiles, dimensions, frame counts, fps and extra profile fields fail closed", () => {
  for (const patch of [{captureProfile: "HDR"}, {width: 1919}, {height: 8192}, {frameCount: 15001}, {fps: 23}, {customFilter: "arbitrary"}])
    assert.throws(() => buildSdrFrameEncoderArguments({...profile, ...patch, framesDirectory: "unused", outputPath: "unused"} as never));
});
async function fixture(run: (parent: string, binaryPath: string, hash: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "sdr-encoder-test-")), binaryPath = join(parent, "mock-binary");
  const bytes = Buffer.from("not an executable, mocked executor only"); await writeFile(binaryPath, bytes);
  const frames = join(parent, "frames"); await mkdir(frames);
  const png = await sharp({create: {width: 16, height: 16, channels: 3, background: "#203040"}}).png().toBuffer();
  for (const name of ["frame_000000.png", "frame_000001.png"]) await writeFile(join(frames, name), png);
  try {await run(parent, binaryPath, createHash("sha256").update(bytes).digest("hex"));}
  finally {
    await rm(binaryPath);
    for (const name of ["frame_000000.png", "frame_000001.png"]) await rm(join(frames, name));
    await rmdir(frames); await rmdir(parent);
  }
}
test("injected encoder receives isolated argv/environment and returns pinned output with owned cleanup", async () => {
  await fixture(async (parent, ffmpegPath, ffmpegSha256) => {
    const result = await encodeSdrCapturedFrames({profile: fixtureProfile, framesDirectory: join(parent, "frames"), outputParentDirectory: parent,
      ffmpegPath, ffmpegSha256, ffprobePath: ffmpegPath, ffprobeSha256: ffmpegSha256, timeoutMilliseconds: 1000}, async (binary, args, options) => {
      if (args.includes("-count_frames")) return mockProbe(args.at(-1)!);
      assert.equal(binary, ffmpegPath); assert.ok(options.timeout > 0 && options.timeout <= 1000);
      assert.equal(options.env.NODE_OPTIONS, undefined); assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
      await writeFile(args.at(-1)!, "synthetic MP4 placeholder, no media evidence", {flag: "wx"});
    });
    assert.ok(result.output.sizeBytes > 0); assert.equal(result.encoderSha256, ffmpegSha256);
    assert.equal(result.policy.scope, "DECLARED_PROFILE_CONVERSION_NOT_CAPTURE_OR_RENDER_ATTESTATION");
    await result.cleanup(); await result.cleanup(); assert.deepEqual(await readdir(parent), ["frames", "mock-binary"]);
  });
});
test("failure and late cancellation remove partial output and never fall back to metadata-only encoding", async () => {
  await fixture(async (parent, ffmpegPath, ffmpegSha256) => {
    for (const cancelled of [false, true]) {
      const abort = new AbortController(); let calls = 0;
      await assert.rejects(encodeSdrCapturedFrames({profile: fixtureProfile, framesDirectory: join(parent, "frames"), outputParentDirectory: parent,
        ffmpegPath, ffmpegSha256, ffprobePath: ffmpegPath, ffprobeSha256: ffmpegSha256, timeoutMilliseconds: 1000, signal: abort.signal}, async (_binary, args, options) => {
        calls++; assert.equal(options.signal, abort.signal);
        await writeFile(args.at(-1)!, "partial");
        if (cancelled) abort.abort("private reason"); else throw new Error("private provider message");
      }), cancelled ? /CONFORMANCE_JOB_EXECUTION_CANCELLED/ : /^Error: SDR_FRAME_ENCODER_FAILED$/);
      assert.equal(calls, 1); assert.deepEqual(await readdir(parent), ["frames", "mock-binary"]);
    }
  });
});
test("binary mutation or missing output fails after execution without publishing a result", async () => {
  await fixture(async (parent, ffmpegPath, ffmpegSha256) => {
    await assert.rejects(encodeSdrCapturedFrames({profile: fixtureProfile, framesDirectory: join(parent, "frames"), outputParentDirectory: parent,
      ffmpegPath, ffmpegSha256, ffprobePath: ffmpegPath, ffprobeSha256: ffmpegSha256, timeoutMilliseconds: 1000}, async () => {}), /SDR_FRAME_ENCODER_FAILED/);
    assert.deepEqual(await readdir(parent), ["frames", "mock-binary"]);
    await assert.rejects(encodeSdrCapturedFrames({profile: fixtureProfile, framesDirectory: join(parent, "frames"), outputParentDirectory: parent,
      ffmpegPath, ffmpegSha256, ffprobePath: ffmpegPath, ffprobeSha256: ffmpegSha256, timeoutMilliseconds: 1000}, async (_binary, args) => {
      if (args.includes("-count_frames")) return mockProbe(args.at(-1)!);
      await writeFile(args.at(-1)!, "placeholder"); await writeFile(ffmpegPath, "changed");
    }), /SDR_FRAME_ENCODER_FAILED/);
    assert.deepEqual(await readdir(parent), ["frames", "mock-binary"]);
  });
});
test("pre-aborted encoder does not read a binary or launch a process", async () => {
  const abort = new AbortController(); abort.abort("private reason");
  await assert.rejects(encodeSdrCapturedFrames({profile, framesDirectory: "unused", outputParentDirectory: "unused",
    ffmpegPath: "unused", ffmpegSha256: "a".repeat(64), ffprobePath: "unused", ffprobeSha256: "a".repeat(64), timeoutMilliseconds: 1000, signal: abort.signal},
  async () => assert.fail("must not launch")), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
});
test("frame mutation during encoder execution invalidates output and cleans only owned video", async () => {
  await fixture(async (parent, ffmpegPath, ffmpegSha256) => {
    await assert.rejects(encodeSdrCapturedFrames({profile: fixtureProfile, framesDirectory: join(parent, "frames"),
      outputParentDirectory: parent, ffmpegPath, ffmpegSha256, ffprobePath: ffmpegPath, ffprobeSha256: ffmpegSha256, timeoutMilliseconds: 1000}, async (_binary, args) => {
      if (args.includes("-count_frames")) return mockProbe(args.at(-1)!);
      await writeFile(args.at(-1)!, "placeholder");
      await writeFile(join(parent, "frames/frame_000000.png"), "changed frame");
    }), /SDR_FRAME_ENCODER_FAILED/);
    assert.deepEqual(await readdir(parent), ["frames", "mock-binary"]);
  });
});
test("wrong probe metadata and mutation during probing cannot publish output", async () => {
  await fixture(async (parent, ffmpegPath, ffmpegSha256) => {
    for (const mutation of ["metadata", "video"] as const) {
      let calls = 0;
      await assert.rejects(encodeSdrCapturedFrames({profile: fixtureProfile, framesDirectory: join(parent, "frames"),
        outputParentDirectory: parent, ffmpegPath, ffmpegSha256, ffprobePath: ffmpegPath,
        ffprobeSha256: ffmpegSha256, timeoutMilliseconds: 1000}, async (_binary, args) => {
        calls++;
        if (!args.includes("-count_frames")) {await writeFile(args.at(-1)!, "placeholder"); return;}
        const result = await mockProbe(args.at(-1)!);
        if (mutation === "video") await writeFile(args.at(-1)!, "x".repeat(11));
        else {const profile = JSON.parse(result.stdout); profile.streams[0].color_transfer = "unknown"; result.stdout = JSON.stringify(profile);}
        return result;
      }), /SDR_FRAME_ENCODER_FAILED/);
      assert.equal(calls, 2); assert.deepEqual(await readdir(parent), ["frames", "mock-binary"]);
    }
  });
});
