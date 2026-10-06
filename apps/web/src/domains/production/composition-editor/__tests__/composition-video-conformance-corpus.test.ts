import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildVideoConformanceCorpusCase, buildVideoCorpusEncodingArguments, listVideoConformanceCorpusRecipes, type VideoCorpusSource } from "../qa/composition-video-conformance-corpus";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "../qa/composition-native-conformance-corpus";
import { resolveCompositionTransitionEligibility } from "../composition-transition.service";
import { buildAudioReferenceMixPlan } from "../qa/composition-audio-reference-mix";
import { compileVideoCorpusFromReceipts } from "../qa/composition-video-corpus-compile";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";

// Controlled source metadata exercises recipes only. No fabricated MP4 bytes or
// claim that this checksum identifies a decoded, generated or measured file.
const source: VideoCorpusSource = {id: "27000000-0000-4000-8000-000000000004", checksum: "a".repeat(64),
  sizeBytes: 1024, durationSeconds: 10, fps: 25, width: 1920, height: 1080, hasAudio: true, mimeType: "video/mp4"};

test("video recipes preserve timing, split offsets and all crossfade handles at every FPS", () => {
  let checked = 0;
  for (const recipe of listVideoConformanceCorpusRecipes()) for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
    const fixture = buildVideoConformanceCorpusCase(recipe, {...source, fps});
    assert.equal(fixture.caseSha256, buildVideoConformanceCorpusCase(recipe, {...source, fps}).caseSha256);
    assert.equal(fixture.scope, "VIDEO_RECIPE_BOUND_TO_SUPPLIED_SOURCE_NOT_DECODE_OR_RENDER_EVIDENCE");
    if (recipe === "video-split") assert.equal(fixture.document.clips[1]!.sourceOffsetSeconds, 4);
    if (recipe === "video-trim") assert.equal(fixture.document.clips[0]!.sourceOffsetSeconds, 2);
    if (recipe.startsWith("video-crossfade-")) {
      const transition = fixture.document.transitions!.items[0]!;
      assert.equal(resolveCompositionTransitionEligibility({document: fixture.document, transition}).available, true);
      const mix = buildAudioReferenceMixPlan(fixture.document);
      assert.equal(mix.clips.length, 2);
      assert.ok(mix.clips[0]!.startSeconds + mix.clips[0]!.durationSeconds > mix.clips[1]!.startSeconds);
      assert.ok(mix.clips.every((clip) => clip.sourceOffsetSeconds >= 0 && clip.sourceOffsetSeconds + clip.durationSeconds <= source.durationSeconds));
    }
    checked++;
  }
  assert.equal(checked, 28);
});

test("encoding argv is bounded, local, stereo and no-overwrite without executing codecs", () => {
  for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
    const args = buildVideoCorpusEncodingArguments({fps, frameDirectory: "D:/corpus", audioPath: "D:/corpus/source.wav", outputPath: "D:/corpus/source.mp4"});
    assert.ok(args.includes("-n")); assert.ok(!args.includes("-y"));
    assert.equal(args[args.indexOf("-framerate") + 1], String(fps));
    assert.ok(args.includes("D:\\corpus\\frame-%03d.png") || args.includes("D:/corpus/frame-%03d.png"));
    assert.equal(args[args.indexOf("-t") + 1], "10");
    assert.equal(args[args.indexOf("-ac") + 1], "2");
    assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
    assert.equal(args.at(-1), "D:/corpus/source.mp4");
  }
  for (const audioPath of ["relative.wav", "https://signed.example/source", "D:/bad\0.wav"])
    assert.throws(() => buildVideoCorpusEncodingArguments({fps: 25, frameDirectory: "D:/corpus", audioPath, outputPath: "D:/corpus/out.mp4"}));
  assert.throws(() => buildVideoCorpusEncodingArguments({fps: 29, frameDirectory: "D:/corpus", audioPath: "D:/corpus/in.wav", outputPath: "D:/corpus/out.mp4"}));
});

test("unknown recipe, missing audio and invalid source identity cannot silently substitute another scenario", () => {
  assert.throws(() => buildVideoConformanceCorpusCase("unknown", source), /RECIPE_UNKNOWN/);
  assert.throws(() => buildVideoConformanceCorpusCase("video-split", {...source, hasAudio: false} as never));
  assert.throws(() => buildVideoConformanceCorpusCase("video-split", {...source, checksum: "not-a-hash"}));
  assert.notEqual(buildVideoConformanceCorpusCase("video-split", source).caseSha256,
    buildVideoConformanceCorpusCase("video-split", {...source, checksum: "b".repeat(64)}).caseSha256);
});

test("all 28 video cases compile through both production targets and freeze a verified preview reference", async () => {
  let compiled = 0;
  for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) for (const recipe of listVideoConformanceCorpusRecipes()) {
    const fixture = buildVideoConformanceCorpusCase(recipe, {...source, fps});
    const asset = {productionAssetId: source.id, checksum: source.checksum, fileSizeBytes: source.sizeBytes,
      mimeType: source.mimeType, storageBucket: "production-assets", storagePath: `corpus/${source.checksum}.mp4`};
    const contract = buildCompositionConformanceContract({contractVersion: 3, document: fixture.document,
      documentHash: fixture.documentHash, assets: [{id: source.id, checksum: source.checksum}],
      renderProfile: {format: "mp4", fps, quality: "high", resolution: "1080p"}});
    const frozen = await buildConformanceReferenceSource({document: fixture.document, contract, assets: [asset]});
    const verified = verifyConformanceReferenceSource(frozen);
    const render = await compileCompositionPreview({document: fixture.document,
      assetUrls: new Map([[source.id, `conformance-media/${source.id}`]]),
      target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER});
    assert.equal(verified.contract.documentHash, fixture.documentHash);
    assert.equal(verified.metadata.bindings[0]?.checksum, source.checksum);
    assert.ok(frozen.previewHtml.includes(`conformance-media/${source.id}`));
    assert.ok(render.includes(`conformance-media/${source.id}`));
    compiled++;
  }
  assert.equal(compiled, 28);
});

test("read-only matrix binds each local receipt to its source bytes and all case identities", async () => {
  // Controlled bytes exercise binding only, not MP4 decode or a provider render.
  const parent = await mkdtemp(join(tmpdir(), "corpus-matrix-test-"));
  const receiptPaths: string[] = []; const directories: string[] = [];
  try {
    for (const fps of NATIVE_CONFORMANCE_CORPUS_FPS) {
      const directory = join(parent, String(fps)); await mkdir(directory); directories.push(directory);
      const bytes = Buffer.from(`controlled-not-mp4-${fps}`);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const currentSource = {...source, fps, checksum, sizeBytes: bytes.length};
      const cases = listVideoConformanceCorpusRecipes().map((recipeId) => {
        const fixture = buildVideoConformanceCorpusCase(recipeId, currentSource);
        return {recipeId, caseSha256: fixture.caseSha256, documentHash: fixture.documentHash};
      });
      await writeFile(join(directory, "source.mp4"), bytes);
      const receiptPath = join(directory, "source-receipt.json"); receiptPaths.push(receiptPath);
      await writeFile(receiptPath, JSON.stringify({scope: "LOCAL_ENCODING_AND_PROBE_NOT_RENDER_PARITY", source: currentSource,
        frameCount: fps * 10, decodedFrames: [{timeSeconds: 0, pngSha256: "a".repeat(64), pixelSha256: "a".repeat(64)},
          {timeSeconds: 5, pngSha256: "b".repeat(64), pixelSha256: "b".repeat(64)}],
        decodedAudio: {decodedPcmSha256: "c".repeat(64), decodedFrames: 480256, measuredWindowCount: 20,
          maximumRmsDeltaDb: 0.5, policy: "CORPUS_STEREO_RMS_HALF_SECOND_V1"}, cases}));
    }
    const report = await compileVideoCorpusFromReceipts(receiptPaths);
    assert.equal(report.caseCount, 28);
    assert.equal(report.scope, "LOCAL_RECEIPT_AND_COMPILATION_NOT_RENDER_EVIDENCE");
    assert.deepEqual(report.sources.map((entry) => entry.fps), [...NATIVE_CONFORMANCE_CORPUS_FPS].sort((a, b) => a - b));
    const firstVideo = join(parent, String(NATIVE_CONFORMANCE_CORPUS_FPS[0]), "source.mp4");
    const originalBytes = await readFile(firstVideo);
    await writeFile(firstVideo, Buffer.alloc(originalBytes.length));
    await assert.rejects(compileVideoCorpusFromReceipts(receiptPaths), /SOURCE_HASH_MISMATCH/);
    await writeFile(firstVideo, originalBytes);
    const firstReceipt = JSON.parse(await readFile(receiptPaths[0]!, "utf8"));
    firstReceipt.cases[0].caseSha256 = "f".repeat(64);
    await writeFile(receiptPaths[0]!, JSON.stringify(firstReceipt));
    await assert.rejects(compileVideoCorpusFromReceipts(receiptPaths), /CASE_RECEIPT_MISMATCH/);
  } finally {
    for (const directory of directories) {
      await rm(join(directory, "source-receipt.json"), {force: true});
      await rm(join(directory, "source.mp4"), {force: true}); await rmdir(directory);
    }
    await rmdir(parent);
  }
});
