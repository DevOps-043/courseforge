import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, writeFile, readFile, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {createOriginalSessionSdrStages} from "./original-session-sdr-stages.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const compiled = "./dist/composition-worker/domains/production/composition-editor/";
const {createInitialCompositionDocument} = require(`${compiled}composition-document.factory.js`);
const {hashCompositionDocument} = require(`${compiled}composition-document.service.js`);
const {buildSnapshotConformanceContract} = require("./.tmp/hyperframes-tests/domains/production/composition-editor/composition-snapshot-conformance-contract.js");
const {createOriginalSessionFrameArchive} = require(`${compiled}qa/composition-original-session-frame-archive.js`);
const {SDR_AUDIO_MUX_POLICY, SDR_FRAME_CONVERSION_POLICY} = require(`${compiled}composition-sdr-conversion-policy.js`);

async function fixture(run, hasAudio = true) {
  const root = await mkdtemp(join(tmpdir(), "cf-original-sdr-"));
  try {
    const outputDirectory = join(root, "output"), work = join(root, "sdk-work");
    await mkdir(outputDirectory); await mkdir(work);
    const encoderPath = join(root, "binary.fixture"), bytes = Buffer.from("not executable"); await writeFile(encoderPath, bytes);
    const identity = {sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length};
    const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
      plan: {accentColor: "#38BDF8", durationSeconds: 1, title: "SDR", subtitle: "Original"}});
    Object.assign(document.canvas, {width: 16, height: 16, durationSeconds: 0.08});
    const contract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
      contractVersion: 4, colorTags: true, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"},
      renderExecution: {policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
        files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, identity])),
        expectedBrowser: {protocolVersion: "1.3", product: "fixture", revision: "fixture", userAgent: "fixture", jsVersion: "fixture"},
        comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1", pixelDecoder: identity, probe: identity},
        sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id, ...(hasAudio ? {sdrAudioMuxPolicy: SDR_AUDIO_MUX_POLICY} : {})}});
    const controller = new AbortController();
    const capture = createOriginalSessionFrameArchive({outputDirectory, contract, signal: controller.signal, verifyFiles: async () => {}});
    const png = await sharp({create: {width: 16, height: 16, channels: 3, background: "#203040"}}).png().toBuffer();
    await capture.captureFrame(0, 0, png); await capture.captureFrame(1, 1 / 25, png);
    const payload = {width: 16, height: 16, fps: 25, frameCount: 2, hasAudio, signal: controller.signal,
      videoOnlyPath: join(work, "silent.mp4"), outputPath: join(outputDirectory, "video.mp4")};
    const execute = async (_binary, args) => {
      const path = args.at(-1);
      if (args.includes("-an")) {await writeFile(path, "silent encoded fixture", {flag: "wx"}); return {stdout: ""};}
      if (args.includes("-show_packets")) return {stdout: JSON.stringify({
        streams: [{codec_type: "video", time_base: "1/12800", extradata_hash: `SHA256:${"e".repeat(64)}`}],
        packets: ["a", "b"].map((hash, index) => ({size: "100", data_hash: `SHA256:${hash.repeat(64)}`,
          pts: index * 512, dts: (index - 2) * 512, duration: 512}))})};
      return {stdout: JSON.stringify({streams: [{codec_type: "video", codec_name: "h264", width: 16, height: 16,
        pix_fmt: "yuv420p", avg_frame_rate: "25/1", nb_read_frames: "2", color_space: "bt709", color_transfer: "bt709",
        color_primaries: "bt709", color_range: "tv", chroma_location: "left", start_time: "0"},
        ...(path === payload.outputPath && hasAudio ? [{codec_type: "audio", codec_name: "aac", sample_rate: "48000",
          channels: 2, start_time: "0", duration: "0.08"}] : [])],
        format: {duration: "0.08", size: String((await stat(path)).size), format_name: "mov,mp4", start_time: "0"}})};
    };
    const input = {contract, signal: controller.signal, outputDirectory, videoPath: payload.outputPath,
      encoderPath, probePath: encoderPath, timeoutMilliseconds: 10000,
      acquireFrames: () => capture.finalize(), verifyFiles: async () => {}};
    await run({input, payload, execute, controller, capture});
  } finally {await rm(root, {recursive: true, force: true});}
}

test("original stage adapter converts the original sequence and verifies copied video packets after SDK mux", async () => {
  await fixture(async ({input, payload, execute}) => {
    const stages = createOriginalSessionSdrStages(input, {execute});
    const encoded = await stages.onEncode(payload); assert.ok(encoded.encodeMs >= 0);
    assert.equal((await readFile(payload.videoOnlyPath)).toString(), "silent encoded fixture");
    await writeFile(payload.outputPath, "muxed fixture, original SDK assembly simulated");
    await stages.onAfterAssemble(payload);
    const result = await stages.finalize();
    assert.equal(result.sdrEncoding.policy.id, SDR_FRAME_CONVERSION_POLICY.id);
    assert.equal(result.sdrMux.policy, SDR_AUDIO_MUX_POLICY);
    await writeFile(payload.outputPath, "changed");
    await assert.rejects(stages.finalize(), /ORIGINAL_SDR_STAGE_FAILED/);
  });
});

test("missing stage, foreign output and abort reject without publishing observations", async () => {
  for (const mode of ["missing", "foreign", "abort"]) await fixture(async ({input, payload, execute, controller}) => {
    const stages = createOriginalSessionSdrStages(input, {execute});
    if (mode === "missing") await assert.rejects(stages.finalize(), /STAGE_FAILED/);
    else {
      if (mode === "abort") controller.abort();
      await assert.rejects(stages.onEncode({...payload, ...(mode === "foreign" ? {outputPath: payload.videoOnlyPath} : {})}), /STAGE_FAILED/);
      await assert.rejects(stages.finalize());
    }
  });
});

test("silent assembly binds different containers through equal observed payloads and timing", async () => {
  for (const changed of [false, true]) await fixture(async ({input, payload, execute}) => {
    const stages = createOriginalSessionSdrStages(input, {execute}); await stages.onEncode(payload);
    await writeFile(payload.outputPath, changed ? "rewritten" : await readFile(payload.videoOnlyPath));
    await stages.onAfterAssemble(payload);
    const result = await stages.finalize();
    assert.equal(result.sdrMux, undefined);
    assert.equal(result.sdrSilentAssembly.videoSha256, createHash("sha256").update(await readFile(payload.outputPath)).digest("hex"));
    assert.equal(result.sdrSilentAssembly.silentVideoSha256, result.sdrEncoding.output.sha256);
  }, false);
});

test("silent stage cannot finalize when SDK assembly changes decode timing", async () => {
  await fixture(async ({input, payload, execute}) => {
    const stages = createOriginalSessionSdrStages(input, {execute: async (binary, args, options) => {
      const result = await execute(binary, args, options);
      if (args.includes("-show_packets") && args.at(-1) === payload.outputPath) {
        const changed = JSON.parse(result.stdout); for (const packet of changed.packets) packet.dts -= 512;
        return {stdout: JSON.stringify(changed)};
      }
      return result;
    }});
    await stages.onEncode(payload); await writeFile(payload.outputPath, "rewritten container");
    await assert.rejects(stages.onAfterAssemble(payload), /STAGE_FAILED/);
    await assert.rejects(stages.finalize(), /STAGE_FAILED/);
  }, false);
});
