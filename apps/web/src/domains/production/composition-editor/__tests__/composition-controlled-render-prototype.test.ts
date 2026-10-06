import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {setTimeout as delay} from "node:timers/promises";
import { renderControlledLocalPrototype, type ControlledRenderPrototypeInput, type ControlledPrototypeExecutor } from "../qa/composition-controlled-render-prototype";
import { compileControlledRenderCorpus, compileControlledVideoCorpus, compileControlledNativeFontCorpus } from "../qa/composition-controlled-render-corpus";
import { auditControlledRenderColor } from "../qa/composition-controlled-render-color-audit";
import {SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";
import { auditControlledSplitRender } from "../qa/composition-controlled-split-audit";
import { renderVideoCorpusFrame } from "../qa/composition-video-corpus-frames";
import { buildVideoConformanceCorpusCase, listVideoConformanceCorpusRecipes } from "../qa/composition-video-conformance-corpus";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "controlled-render-test-"));
  const dist = join(directory, "dist"); await mkdir(dist);
  const paths = {node: join(directory, "node"), package: join(directory, "package.json"), cli: join(dist, "cli.js"),
    runtime: join(dist, "hyperframe-runtime.js"), browser: join(directory, "browser"), ffmpeg: join(directory, "ffmpeg"), ffprobe: join(directory, "ffprobe")};
  const tools = {} as ControlledRenderPrototypeInput["tools"];
  for (const [role, path] of Object.entries(paths)) {
    const bytes = role === "package" ? JSON.stringify({name: "hyperframes", version: "0.7.106"}) : `synthetic ${role}; not executable evidence`;
    await writeFile(path, bytes); tools[role as keyof typeof tools] = {path, sha256: createHash("sha256").update(bytes).digest("hex")};
  }
  const html = "synthetic input; not a renderable HTML", entry = join(directory, "index.html"); await writeFile(entry, html);
  const input: ControlledRenderPrototypeInput = {trustedLocalSyntheticProject: true, tools, projectDirectory: directory,
    outputParentDirectory: directory, projectFiles: [{id: "entry", path: entry, sha256: createHash("sha256").update(html).digest("hex")}],
    fps: 25, quality: "high", width: 1920, height: 1080, durationSeconds: 4, timeoutMs: 1000};
  return {directory, input};
}

const probe = JSON.stringify({format: {duration: "4"}, streams: [{codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "25/1"}]});
test("prototype enforces a total render/probe budget and aborts a late probe", async () => {
  const {directory, input} = await fixture(); let probeTimeout = 0, probeAborted = false;
  let acknowledgeCancellation!: () => void;
  const cancellationAcknowledged = new Promise<void>(resolve => {acknowledgeCancellation = resolve;});
  try {
    await assert.rejects(renderControlledLocalPrototype(input, async (binary, args, options) => {
      if (args.includes("render")) {
        await delay(650, undefined, {signal: options.signal});
        return successfulExecutor(binary, args, options);
      }
      probeTimeout = options.timeout;
      try {await delay(650, undefined, {signal: options.signal});}
      catch {probeAborted = options.signal?.aborted === true; acknowledgeCancellation(); throw new Error("private provider stderr");}
      return {stdout: probe};
    }), error => error instanceof Error && error.message === "CONTROLLED_RENDER_DEADLINE_EXCEEDED");
    assert.ok(probeTimeout > 0 && probeTimeout < 600);
    // Verdict invalidation is immediate; the adapter acknowledges abort asynchronously.
    await cancellationAcknowledged; assert.equal(probeAborted, true);
  } finally {await rm(directory, {recursive: true, force: true});}
});
test("filesystem preparation failures cannot expose paths before the render stage", async () => {
  const {directory, input} = await fixture(); let called = false;
  try {
    input.projectDirectory = join(directory, "missing-private-directory");
    input.projectFiles[0]!.path = join(input.projectDirectory, "index.html");
    await assert.rejects(renderControlledLocalPrototype(input, async () => {called = true; return {stdout: ""};}),
      error => error instanceof Error && error.message === "CONTROLLED_RENDER_PREPARATION_FAILED");
    assert.equal(called, false);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("native font corpus compilation binds bytes, custom CSS and document identity without claiming font decoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "controlled-native-font-"));
  const path = join(directory, "synthetic.woff2");
  try {
    const importCompiler = new Function("return import('@hyperframes/core/compiler')") as () => Promise<{
      stripEmbeddedRuntimeScripts: (html: string) => string;
    }>;
    const {stripEmbeddedRuntimeScripts} = await importCompiler();
    await writeFile(path, "synthetic font bytes; not decoding evidence");
    for (const fps of [24, 25, 30, 60] as const) {
      const prepared = await compileControlledNativeFontCorpus(fps, "geometry-rotation", path);
      assert.match(prepared.html, new RegExp(prepared.materializedFontPath.replace(/\./g, "\\.")));
      assert.equal(prepared.fonts[0].checksumSha256, prepared.fontPin.sha256);
      assert.ok(prepared.fixture.document.clips.every(clip => clip.source.type === "NATIVE_TEXT"
        && clip.source.style.fontAssetId === prepared.fonts[0].fontAssetId));
      const body = prepared.html.slice(prepared.html.indexOf("<body>"), prepared.html.indexOf("</body>"));
      const sources = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
      assert.ok(stripEmbeddedRuntimeScripts(`<script>${sources.join("\n;\n")}</script>`)
        .includes('window.__timelines["courseforge-composition"]'));
      const repeated = await compileControlledNativeFontCorpus(fps, "geometry-rotation", path);
      assert.equal(repeated.fixture.caseSha256, prepared.fixture.caseSha256);
    }
    await assert.rejects(compileControlledNativeFontCorpus(25, "color-neutral", path), /FONT_RECIPE_INVALID/);
    await assert.rejects(compileControlledNativeFontCorpus(25, "geometry-rotation", "relative.woff2"), /FONT_ARGUMENT_INVALID/);
    const before = await compileControlledNativeFontCorpus(25, "captions-srt", path);
    await writeFile(path, "changed synthetic font");
    const after = await compileControlledNativeFontCorpus(25, "captions-srt", path);
    assert.notEqual(before.fixture.caseSha256, after.fixture.caseSha256);
    // Document references retain their asset UUID; byte identity belongs to the manifest/case binding.
    assert.equal(before.fixture.documentHash, after.fixture.documentHash);
  } finally {await rm(path, {force: true}); await rmdir(directory);}
});
const successfulExecutor: ControlledPrototypeExecutor = async (_binary, args) => {
  if (args.includes("render")) {await writeFile(args[args.indexOf("--output") + 1]!, "synthetic output; not codec evidence"); return {stdout: ""};}
  return {stdout: probe};
};

test("split evaluator rejects incorrect source times, gain, input hash and decoder failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "controlled-split-audit-"));
  const videoPath = join(directory, "final.mp4"), sourcePath = join(directory, "source.mp4"), ffmpegPath = join(directory, "ffmpeg");
  const bytes = "synthetic pin; not actual codec evidence", digest = createHash("sha256").update(bytes).digest("hex");
  try {
    for (const path of [videoPath, sourcePath, ffmpegPath]) await writeFile(path, bytes);
    const input = {fps: 25 as const, videoPath, sourcePath, ffmpegPath,
      videoSha256: digest, sourceSha256: digest, ffmpegSha256: digest};
    let sourceFrameDelta = 0, renderedGain = 0.8;
    const decode = async (_binary: string, args: string[]) => {
      const time = Number(args[args.indexOf("-ss") + 1]);
      if (args.includes("png")) return {stdout: await renderVideoCorpusFrame(25 + Math.round(time * 25) + sourceFrameDelta, 250)};
      const pcm = Buffer.alloc(48000 * 8 * 2 * 4), sample = args.includes(sourcePath) ? 0.5 : 0.5 * renderedGain;
      for (let offset = 0; offset < pcm.length; offset += 4) pcm.writeFloatLE(sample, offset);
      return {stdout: pcm};
    };
    const result = await auditControlledSplitRender(input, decode);
    assert.equal(result.status, "PASS"); assert.equal(result.frames.length, 6); assert.equal(result.audio.windowCount, 32);
    sourceFrameDelta = 1;
    await assert.rejects(auditControlledSplitRender(input, decode), /SOURCE_TIME_MISMATCH/);
    sourceFrameDelta = 0; renderedGain = 1;
    await assert.rejects(auditControlledSplitRender(input, decode), /AUDIO_GAIN_MISMATCH/);
    await assert.rejects(auditControlledSplitRender({...input, sourceSha256: "0".repeat(64)}, decode), /HASH_MISMATCH/);
    await assert.rejects(auditControlledSplitRender(input, async () => {throw new Error("private path");}),
      /^Error: CONTROLLED_RENDER_SPLIT_AUDIT_DECODE_FAILED$/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("controlled video preparation binds a recorded authored case to exact source bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "controlled-video-preparation-"));
  const receiptPath = join(directory, "source-receipt.json"), sourcePath = join(directory, "source.mp4");
  const bytes = "synthetic fixture; preparation does not prove a codec", checksum = createHash("sha256").update(bytes).digest("hex");
  const source = {id: "27000000-0000-4000-8000-000000000004", checksum, sizeBytes: Buffer.byteLength(bytes),
    durationSeconds: 10 as const, fps: 25 as const, width: 1920 as const, height: 1080 as const, hasAudio: true as const, mimeType: "video/mp4" as const};
  const receipt = {scope: "LOCAL_ENCODING_AND_PROBE_NOT_RENDER_PARITY", source, frameCount: 250,
    decodedFrames: [{timeSeconds: 0, pngSha256: "a".repeat(64), pixelSha256: "a".repeat(64)},
      {timeSeconds: 5, pngSha256: "b".repeat(64), pixelSha256: "b".repeat(64)}],
    decodedAudio: {decodedPcmSha256: "c".repeat(64), decodedFrames: 480000, measuredWindowCount: 20,
      maximumRmsDeltaDb: 0.1, policy: "CORPUS_STEREO_RMS_HALF_SECOND_V1"},
    cases: listVideoConformanceCorpusRecipes().map((recipeId) => {
      const fixture = buildVideoConformanceCorpusCase(recipeId, source);
      return {recipeId, caseSha256: fixture.caseSha256, documentHash: fixture.documentHash};
    })};
  try {
    await writeFile(sourcePath, bytes); await writeFile(receiptPath, JSON.stringify(receipt));
    const prepared = await compileControlledVideoCorpus(receiptPath, "video-split");
    assert.equal(prepared.sourceSha256, checksum); assert.ok(prepared.html.includes("assets/source.mp4"));
    assert.equal(prepared.fixture.document.clips.length, 2);
    await assert.rejects(compileControlledVideoCorpus("relative", "video-split"), /SOURCE_ARGUMENT_INVALID/);
    receipt.cases[0]!.caseSha256 = "0".repeat(64); await writeFile(receiptPath, JSON.stringify(receipt));
    await assert.rejects(compileControlledVideoCorpus(receiptPath, "video-split"), /SOURCE_CASE_MISMATCH/);
    await writeFile(sourcePath, "changed source");
    await assert.rejects(compileControlledVideoCorpus(receiptPath, "video-split"), /SOURCE_EVIDENCE_INVALID/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("prototype binds fixed argv, allowlisted environment and rechecked files without claiming attestation", async () => {
  const {directory, input} = await fixture();
  try {
    const result = await renderControlledLocalPrototype(input, async (binary, args, options) => {
      assert.equal(options.env.HYPERFRAMES_NO_TELEMETRY, "1");
      assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
      assert.equal(options.env.PRODUCER_HEADLESS_SHELL_PATH, input.tools.browser.path);
      if (args.includes("render")) {
        assert.equal(binary, input.tools.node.path); assert.ok(args.includes("--no-best-effort"));
        assert.ok(args.includes("--sdr")); assert.equal(args[args.indexOf("--fps") + 1], "25");
      } else {
        assert.ok(args[args.indexOf("-show_entries") + 1]!.includes("color_primaries,color_transfer,color_range"));
      }
      return successfulExecutor(binary, args, options);
    });
    assert.equal(result.receipt.scope, "LOCAL_RENDER_NOT_PRODUCTION_ATTESTATION");
    assert.equal(result.receipt.descriptor.inputs.length, 8);
    assert.ok(result.receipt.incomplete.includes("EFFECTIVE_FONTS"));
    assert.equal(JSON.stringify(result.receipt).includes(directory), false);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("prototype refuses changed inputs and changed files during execution", async () => {
  const {directory, input} = await fixture();
  try {
    await assert.rejects(renderControlledLocalPrototype({...input, tools: {...input.tools, browser: {...input.tools.browser, sha256: "0".repeat(64)}}},
      successfulExecutor), /INPUT_HASH_MISMATCH/);
    await assert.rejects(renderControlledLocalPrototype(input, async (binary, args, options) => {
      const result = await successfulExecutor(binary, args, options);
      if (args.includes("render")) await writeFile(input.tools.runtime.path, "mutated runtime");
      return result;
    }), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("prototype rejects wrong profiles, sanitizes executor failures and refuses untrusted/cancelled work", async () => {
  const {directory, input} = await fixture();
  try {
    await assert.rejects(renderControlledLocalPrototype(input, async (binary, args, options) => {
      const result = await successfulExecutor(binary, args, options);
      return args.includes("render") ? result : {stdout: probe.replace("25/1", "30/1")};
    }), /OUTPUT_PROFILE_MISMATCH/);
    await assert.rejects(renderControlledLocalPrototype(input, async () => {throw new Error("private provider stderr");}),
      {message: "CONTROLLED_RENDER_RENDER_FAILED"});
    await assert.rejects(renderControlledLocalPrototype({...input, trustedLocalSyntheticProject: false} as unknown as ControlledRenderPrototypeInput), /ARGUMENTS_INVALID/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(renderControlledLocalPrototype({...input, signal: controller.signal}), /CONTROLLED_RENDER_ABORTED/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("prototype verifies package version rather than accepting a configured version label", async () => {
  const {directory, input} = await fixture();
  try {
    const metadata = JSON.stringify({name: "hyperframes", version: "0.7.107"});
    await writeFile(input.tools.package.path, metadata);
    const tools = {...input.tools, package: {...input.tools.package, sha256: createHash("sha256").update(metadata).digest("hex")}};
    await assert.rejects(renderControlledLocalPrototype({...input, tools}, successfulExecutor), /EXECUTOR_VERSION_MISMATCH/);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("producer corpus preserves timeline after official runtime sanitization of merged body scripts", async () => {
  // Native dynamic import is necessary because the official compiler package is ESM.
  const importModule = new Function("return import('@hyperframes/core/compiler')") as () => Promise<{
    stripEmbeddedRuntimeScripts: (html: string) => string;
  }>;
  const {stripEmbeddedRuntimeScripts} = await importModule();
  for (const fps of [24, 25, 30, 60] as const) {
    const {fixture, html} = await compileControlledRenderCorpus(fps);
    assert.equal(fixture.document.canvas.fps, fps);
    assert.ok(html.includes('window.__timelines["courseforge-composition"] = timeline;'));
    assert.ok(!html.includes("__HF_EXPORT_RENDER_SEEK_CONFIG"));
    assert.ok(!html.includes("hyperframe.runtime.iife.js"));
    // The producer normalizes inline body scripts into one block before injecting runtime.
    const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
    const inlineSources = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(inlineSources.length > 0);
    const merged = `<script>${inlineSources.join("\n;\n")}</script>`;
    assert.ok(stripEmbeddedRuntimeScripts(merged).includes('window.__timelines["courseforge-composition"]'));
    const legacyMerged = merged.replace("</script>", `;window.__HF_EXPORT_RENDER_SEEK_CONFIG={fps:${fps}};</script>`);
    assert.equal(stripEmbeddedRuntimeScripts(legacyMerged).includes("window.__timelines["), false);
  }
});

test("decoded chart binds file hashes, rejects wrong colors and sanitizes decoder failures", async () => {
  const {directory, input} = await fixture();
  try {
    const {fixture: corpus} = await compileControlledRenderCorpus(25);
    assert.ok(corpus.colorAuditPlan);
    const svg = corpus.assets.find((asset) => asset.checksum === corpus.colorAuditPlan!.sourceSvgSha256)!;
    const png = await sharp(Buffer.from(svg.content)).png().toBuffer();
    const videoPath = join(directory, "fake-video.mp4"), bytes = "controlled bytes, not an encoded video";
    await writeFile(videoPath, bytes);
    const request = {videoPath, videoSha256: createHash("sha256").update(bytes).digest("hex"),
      ffmpegPath: input.tools.ffmpeg.path, ffmpegSha256: input.tools.ffmpeg.sha256,
      plan: corpus.colorAuditPlan, fps: 25 as const, durationSeconds: 8};
    const report = await auditControlledRenderColor(request, async (_binary, args, options) => {
      assert.ok(args.includes("file,pipe")); assert.equal(options.encoding, "buffer");
      assert.equal(args.includes("-vf"), false);
      return {stdout: png};
    });
    assert.equal(report.status, "PASS"); assert.deepEqual(report.frames.map((frame) => frame.frameIndex), [0, 100, 199]);
    assert.equal(report.videoSha256, request.videoSha256);
    const sdrReport = await auditControlledRenderColor({...request, sdrConversionPolicy: SDR_FRAME_CONVERSION_POLICY.id},
      async (_binary, args) => {
        assert.equal(args[args.indexOf("-vf") + 1], SDR_FRAME_CONVERSION_POLICY.compareFilter);
        return {stdout: png};
      });
    assert.equal(sdrReport.status, "PASS");
    assert.equal(sdrReport.sdrConversionPolicy, SDR_FRAME_CONVERSION_POLICY.id);
    assert.equal(sdrReport.scope, "DECODED_LOCAL_MP4_NEUTRAL_CHART_NOT_PREVIEW_PARITY_OR_SDR_ATTESTATION");
    let invalidDecodeCalled = false;
    await assert.rejects(auditControlledRenderColor({...request, sdrConversionPolicy: "GUESS" as never}, async () => {
      invalidDecodeCalled = true; return {stdout: png};
    }), /COLOR_ARGUMENTS_INVALID/);
    assert.equal(invalidDecodeCalled, false);
    const black = await sharp({create: {width: 1920, height: 1080, channels: 3, background: "black"}}).png().toBuffer();
    assert.equal((await auditControlledRenderColor(request, async () => ({stdout: black}))).status, "FAIL");
    await assert.rejects(auditControlledRenderColor(request, async () => {throw new Error("private stderr");}),
      {message: "CONTROLLED_RENDER_COLOR_DECODE_FAILED"});
    await assert.rejects(auditControlledRenderColor({...request, videoSha256: "0".repeat(64)}, async () => ({stdout: png})), /COLOR_HASH_MISMATCH/);
    await assert.rejects(auditControlledRenderColor(request, async () => {
      await writeFile(videoPath, "mutated during decode"); return {stdout: png};
    }), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  } finally {await rm(directory, {recursive: true, force: true});}
});
