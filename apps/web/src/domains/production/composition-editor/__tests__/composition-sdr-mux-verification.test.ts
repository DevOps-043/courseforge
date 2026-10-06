import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hashSdrVideoPackets, verifySdrAudioMuxOutput} from "../qa/composition-sdr-mux-verification";
import {SDR_AUDIO_MUX_POLICY} from "../composition-sdr-conversion-policy";

const packets = () => ({streams: [{codec_type: "video", time_base: "1/12800", extradata_hash: `SHA256:${"e".repeat(64)}`}],
  packets: ["a", "b"].map((hash, index) => ({size: "100", data_hash: `SHA256:${hash.repeat(64)}`,
    pts: index * 512, dts: (index - 2) * 512, duration: 512}))});
test("video payload identity covers ordered packets, sizes and codec extradata, not timestamps", () => {
  const baseline = hashSdrVideoPackets(JSON.stringify(packets()), 2);
  for (const kind of ["order", "hash", "size", "extradata"] as const) {
    const changed = packets();
    if (kind === "order") changed.packets.reverse();
    if (kind === "hash") changed.packets[0]!.data_hash = `SHA256:${"c".repeat(64)}`;
    if (kind === "size") changed.packets[0]!.size = "101";
    if (kind === "extradata") changed.streams[0]!.extradata_hash = `SHA256:${"f".repeat(64)}`;
    assert.notEqual(hashSdrVideoPackets(JSON.stringify(changed), 2), baseline);
  }
  assert.equal(hashSdrVideoPackets(JSON.stringify(packets()).replaceAll("SHA256", "sha256"), 2), baseline);
});
test("payload parser bounds counts and JSON, rejects missing hashes, unknown algorithms and truncated output", () => {
  for (const encoded of [undefined, "not JSON", "{}", " ".repeat(16 * 1024 * 1024 + 1),
    JSON.stringify({...packets(), packets: []}), JSON.stringify({...packets(), streams: []}),
    JSON.stringify(packets()).replaceAll("SHA256", "MD5"), JSON.stringify(packets()).replaceAll("data_hash", "missing_hash")])
    assert.throws(() => hashSdrVideoPackets(encoded, 2), /VIDEO_PACKETS_INVALID/);
  for (const count of [0, 1, 3, 36001, NaN]) assert.throws(() => hashSdrVideoPackets(JSON.stringify(packets()), count));
});

async function fixture(run: (input: Parameters<typeof verifySdrAudioMuxOutput>[0], metadata: () => unknown) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "sdr-mux-test-"));
  const silentVideoPath = join(directory, "silent.fixture"), videoPath = join(directory, "mux.fixture"), ffprobePath = join(directory, "probe.fixture");
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const silent = "synthetic silent file", output = "synthetic mux file", probe = "not executable";
  await writeFile(silentVideoPath, silent); await writeFile(videoPath, output); await writeFile(ffprobePath, probe);
  const input = {silentVideoPath, videoPath, ffprobePath, silentVideoSha256: hash(silent), videoSha256: hash(output),
    ffprobeSha256: hash(probe), profile: {width: 16, height: 16, fps: 25, frameCount: 2}, timeoutMilliseconds: 1000};
  const metadata = () => ({streams: [{codec_type: "video", codec_name: "h264", width: 16, height: 16, pix_fmt: "yuv420p",
    avg_frame_rate: "25/1", nb_read_frames: "2", color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709",
    color_range: "tv", chroma_location: "left", start_time: "0"},
    {codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, start_time: "0", duration: "0.08"}],
    format: {duration: "0.08", size: String(Buffer.byteLength(output)), format_name: "mov,mp4", start_time: "0"}});
  try {await run(input, metadata);} finally {
    for (const path of [silentVideoPath, videoPath, ffprobePath]) await rm(path, {force: true});
    await rmdir(directory);
  }
}
test("mux verifier binds final counted profile and copied payloads to rechecked files", async () => {
  await fixture(async (input, metadata) => {
    let calls = 0;
    const result = await verifySdrAudioMuxOutput(input, async (binary, args, options) => {
      calls++; assert.equal(binary, input.ffprobePath); assert.ok(args.includes("file,pipe"));
      assert.ok(options.timeout > 0 && options.timeout <= 1000); assert.equal(options.env.NODE_OPTIONS, undefined);
      return {stdout: JSON.stringify(args.includes("-count_frames") ? metadata() : packets())};
    });
    assert.equal(calls, 3); assert.equal(result.policy, SDR_AUDIO_MUX_POLICY);
    assert.equal(result.videoSha256, input.videoSha256);
    assert.equal(result.scope, "LOCAL_PROBED_VIDEO_PAYLOADS_NOT_SYNC_OR_RENDER_ATTESTATION");
    assert.equal(JSON.stringify(result).includes(input.videoPath), false);
  });
});
test("lost payload, re-encode or changed codec extradata cannot pass even with matching metadata", async () => {
  await fixture(async (input, metadata) => {
    for (const kind of ["hash", "extradata"] as const) await assert.rejects(verifySdrAudioMuxOutput(input, async (_binary, args) => {
      if (args.includes("-count_frames")) return {stdout: JSON.stringify(metadata())};
      const changed = packets();
      if (args.at(-1) === input.videoPath) {
        if (kind === "hash") changed.packets[0]!.data_hash = `SHA256:${"c".repeat(64)}`;
        else changed.streams[0]!.extradata_hash = `SHA256:${"f".repeat(64)}`;
      }
      return {stdout: JSON.stringify(changed)};
    }), /VIDEO_PAYLOAD_CHANGED/);
  });
});
test("mux cannot change decode timestamps or retain payloads with a broken presentation grid", async () => {
  await fixture(async (input, metadata) => {
    for (const kind of ["decode", "presentation"] as const) await assert.rejects(verifySdrAudioMuxOutput(input, async (_binary, args) => {
      if (args.includes("-count_frames")) return {stdout: JSON.stringify(metadata())};
      const changed = packets();
      if (args.at(-1) === input.videoPath) {
        if (kind === "decode") for (const packet of changed.packets) packet.dts -= 512;
        else changed.packets[1]!.pts = 0;
      }
      return {stdout: JSON.stringify(changed)};
    }), kind === "decode" ? /TIMING_CHANGED/ : /TIMING_INVALID/);
  });
});
test("metadata drift, missing/wrong audio or final color tags fail before packet comparisons", async () => {
  await fixture(async (input, metadata) => {
    for (const patch of [{streams: []}, {streams: [metadata() as never]},
      {format: {duration: "1", size: "1", format_name: "mp4", start_time: "0"}}]) {
      let calls = 0;
      await assert.rejects(verifySdrAudioMuxOutput(input, async () => {calls++; return {stdout: JSON.stringify({...metadata() as object, ...patch})};}), /OUTPUT_PROFILE_INVALID/);
      assert.equal(calls, 1);
    }
  });
});
test("persistent mutation of any pinned file after probes invalidates the result", async () => {
  for (const role of ["silentVideoPath", "videoPath", "ffprobePath"] as const) await fixture(async (input, metadata) => {
    let calls = 0;
    await assert.rejects(verifySdrAudioMuxOutput(input, async (_binary, args) => {
      if (++calls === 3) await writeFile(input[role], "changed file");
      return {stdout: JSON.stringify(args.includes("-count_frames") ? metadata() : packets())};
    }), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  });
});
test("invalid inputs and cancellation prevent starting or accepting a late probe", async () => {
  await fixture(async (input, metadata) => {
    const abort = new AbortController(); abort.abort("private reason");
    await assert.rejects(verifySdrAudioMuxOutput({...input, signal: abort.signal}), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
    let called = false;
    await assert.rejects(verifySdrAudioMuxOutput({...input, profile: {...input.profile, fps: 0}}, async () => {called = true; return {stdout: ""};}));
    assert.equal(called, false);
    const late = new AbortController();
    await assert.rejects(verifySdrAudioMuxOutput({...input, signal: late.signal}, async () => {
      late.abort("private reason"); return {stdout: JSON.stringify(metadata())};
    }), /^Error: CONFORMANCE_JOB_EXECUTION_CANCELLED$/);
  });
});
