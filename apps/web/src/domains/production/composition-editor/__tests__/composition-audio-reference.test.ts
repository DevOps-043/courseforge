import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import test from "node:test";
import { buildConformanceReferenceSource } from "../composition-conformance-reference.service";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { buildAudioReferenceMixPlan, encodeAudioReferenceWav, mixAudioReferencePcm } from "../qa/composition-audio-reference-mix";
import { audioReferenceDecodeArguments, createMaterializedAudioReference } from "../qa/composition-audio-reference";
import { materializeConformanceReference } from "../qa/composition-conformance-materialization";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { compareVideoWithSourceAudioReference } from "../qa/composition-source-audio-comparison";

const identifier = "70000000-0000-4000-8000-000000000001";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const content = Buffer.from("pinned decoder fixture");
function documentFixture(video = false) {
  return createInitialCompositionDocument({ animatedDeck: null, assets: [{ productionAssetId: identifier,
    checksum: sha256(content), fileSizeBytes: content.length, durationSeconds: 3, mimeType: video ? "video/mp4" : "audio/wav",
    hasAudio: true, publicUrl: null, storageBucket: "production-assets", storagePath: "media/source", timelineRole: video ? "AVATAR" : "VOICE" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 3, subtitle: "Audio", title: "Audio reference" } });
}
function pcm(left = 0.25, right = -0.25, seconds = 3) {
  const bytes = Buffer.alloc(8000 * seconds * 8);
  for (let index = 0; index < bytes.length; index += 8) { bytes.writeFloatLE(left, index); bytes.writeFloatLE(right, index + 4); }
  return bytes;
}
test("mix plan shares audibility rules and mute/hidden state", () => {
  const document = documentFixture(); assert.equal(buildAudioReferenceMixPlan(document).clips.length, 1);
  document.tracks.find((track) => track.id === document.clips[0]!.trackId)!.muted = true;
  assert.equal(buildAudioReferenceMixPlan(document).clips.length, 0);
  document.tracks.forEach((track) => { track.muted = false; }); document.clips[0]!.hidden = true;
  assert.equal(buildAudioReferenceMixPlan(document).clips.length, 0);
});
test("stereo preserves phase and combines clip and track gain", () => {
  const document = documentFixture(); document.clips[0]!.volume = 0.5;
  document.tracks.find((track) => track.id === document.clips[0]!.trackId)!.volume = 0.5;
  const result = mixAudioReferencePcm(buildAudioReferenceMixPlan(document), new Map([[identifier, pcm()]]));
  assert.equal(result.pcm.readFloatLE(0), 0.0625); assert.equal(result.pcm.readFloatLE(4), -0.0625);
});
test("fades use shared piecewise automation and preserve full timeline silence", () => {
  const document = documentFixture(); const clip = document.clips[0]!;
  clip.startSeconds = 1; clip.durationSeconds = 2; clip.fadeInSeconds = 1; clip.fadeOutSeconds = 1;
  const result = mixAudioReferencePcm(buildAudioReferenceMixPlan(document), new Map([[identifier, pcm()]]));
  assert.equal(result.pcm.length, 3 * 8000 * 8); assert.equal(result.pcm.readFloatLE(0), 0);
  assert.equal(result.pcm.readFloatLE(12000 * 8), 0.125); assert.equal(result.pcm.readFloatLE(16000 * 8), 0.25);
});
test("music ducking reuses the same trigger and automation envelope as preview", () => {
  const document = documentFixture(); const voice = document.clips[0]!;
  voice.startSeconds = 1; voice.durationSeconds = 1;
  const track = document.tracks.find((candidate) => candidate.id === voice.trackId)!;
  document.tracks.push({ ...track, id: "music-ref", semanticRole: "MUSIC", volume: 0.2 });
  const musicAssetId = "80000000-0000-4000-8000-000000000001";
  document.clips.push({ ...voice, id: "music-clip-ref", hfId: "music-clip-ref", trackId: "music-ref",
    startSeconds: 0, durationSeconds: 3, source: { type: "PRODUCTION_ASSET", productionAssetId: musicAssetId, hasAudio: true } });
  document.audioMix.ducking.enabled = true;
  const plan = buildAudioReferenceMixPlan(document); const music = plan.clips.find((clip) => clip.assetId === musicAssetId)!;
  const reduced = music.points.find((point) => point.timeSeconds === 1)!.volume;
  assert.ok(reduced < 0.2);
  const samples = mixAudioReferencePcm(plan, new Map([[identifier, pcm(0, 0)], [musicAssetId, pcm()]])).pcm;
  assert.ok(Math.abs(samples.readFloatLE(12000 * 8) - 0.25 * reduced) < 1e-6);
});
test("crossfade shares runtime handles and source offsets with preview", () => {
  const document = documentFixture(true); const first = document.clips[0]!; first.durationSeconds = 1.5;
  document.clips.push({ ...first, id: "second-video", hfId: "second-video", startSeconds: 1.5, sourceOffsetSeconds: 1.5 });
  document.transitions = { schemaVersion: 1, items: [{ id: "audio-crossfade", fromClipId: first.id, toClipId: "second-video",
    durationSeconds: 0.2, type: "CROSS_DISSOLVE", alignment: "CENTER_AT_CUT", audioMode: "CROSSFADE", easing: "power1.inOut", origin: "USER" }] };
  const plan = buildAudioReferenceMixPlan(document);
  assert.equal(plan.clips[0]!.durationSeconds, 1.6);
  assert.equal(plan.clips[1]!.startSeconds, 1.4);
  assert.equal(plan.clips[1]!.sourceOffsetSeconds, 1.4);
  const samples = mixAudioReferencePcm(plan, new Map([[identifier, pcm()]])).pcm;
  assert.ok(Math.abs(samples.readFloatLE(12000 * 8) - 0.25) < 1e-6);
});
test("source offset, non-loop exhaustion and video audio loop have distinct semantics", () => {
  const audioPlan = buildAudioReferenceMixPlan(documentFixture()); audioPlan.clips[0]!.sourceOffsetSeconds = 0.5;
  const source = pcm(0.25, -0.25, 1);
  const audio = mixAudioReferencePcm(audioPlan, new Map([[identifier, source]])).pcm;
  assert.equal(audio.readFloatLE(0), 0.25); assert.equal(audio.readFloatLE(8000 * 8), 0);
  const video = mixAudioReferencePcm(buildAudioReferenceMixPlan(documentFixture(true)), new Map([[identifier, source]])).pcm;
  assert.equal(video.readFloatLE(16000 * 8), 0.25);
});
test("missing sources, invalid PCM and overloaded mix fail explicitly", () => {
  const plan = buildAudioReferenceMixPlan(documentFixture());
  assert.throws(() => mixAudioReferencePcm(plan, new Map()), /SOURCE_MISSING/);
  const invalid = pcm(); invalid.writeFloatLE(Number.NaN, 0);
  assert.throws(() => mixAudioReferencePcm(plan, new Map([[identifier, invalid]])), /PCM_INVALID/);
  plan.clips.push({ ...plan.clips[0]!, clipId: "overlap" });
  assert.throws(() => mixAudioReferencePcm(plan, new Map([[identifier, pcm(0.75, 0.75)]])), /MIX_CLIPPING/);
});
test("float WAV contains fixed stereo format and exact decoded PCM", () => {
  const samples = pcm(); const wav = encodeAudioReferenceWav(samples);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF"); assert.equal(wav.readUInt16LE(20), 3);
  assert.equal(wav.readUInt32LE(24), 8000); assert.equal(wav.readUInt16LE(22), 2);
  assert.deepEqual(wav.subarray(44), samples);
});
test("decoder is file-only, bounded, shell-free and rejects remote paths", () => {
  const args = audioReferenceDecodeArguments("owned/source");
  assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file,pipe");
  assert.equal(args[args.indexOf("-t") + 1], "601");
  assert.throws(() => audioReferenceDecodeArguments("https://untrusted.example/audio"), /PATH_INVALID/);
});
test("compiled video volume automation targets audio element rather than visual container", async () => {
  const document = documentFixture(true); document.clips[0]!.fadeInSeconds = 1;
  const html = await compileCompositionPreview({ document, assetUrls: new Map([[identifier, "media/local.mp4"]]) });
  assert.match(html, /document\.getElementById\(automation.targetClipId \+ "-audio"\)/);
  assert.ok(html.includes(`id="${document.clips[0]!.id}-audio"`));
});

async function withMaterialized(run: (input: Awaited<ReturnType<typeof materializeConformanceReference>>, parent: string) => Promise<void>, legacyVideo = false, legacyCrossfade = false, durationSeconds = 3) {
  const parent = await mkdtemp(join(tmpdir(), "audio-reference-test-"));
  let materialized: Awaited<ReturnType<typeof materializeConformanceReference>> | undefined;
  try {
    // Frozen revisions originate from JSON persistence, without factory-only undefined properties.
    const document = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(documentFixture(legacyVideo))));
    document.canvas.durationSeconds = durationSeconds;
    if (legacyVideo) document.clips[0]!.fadeInSeconds = 1;
    if (legacyCrossfade) {
      const first = document.clips[0]!; first.durationSeconds = 1.5;
      document.clips.push({ ...first, id: "second-video", hfId: "second-video", startSeconds: 1.5, sourceOffsetSeconds: 1.5 });
      document.transitions = { schemaVersion: 1, items: [{ id: "legacy-crossfade", fromClipId: first.id, toClipId: "second-video",
        durationSeconds: 0.2, type: "CROSS_DISSOLVE", alignment: "CENTER_AT_CUT", audioMode: "CROSSFADE", easing: "power1.inOut", origin: "USER" }] };
    }
    const mimeType = legacyVideo ? "video/mp4" : "audio/wav";
    const contract = buildCompositionConformanceContract({ document, documentHash: hashCompositionDocument(document),
      assets: [{ id: identifier, checksum: sha256(content) }], renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" } });
    const source = await buildConformanceReferenceSource({ document, contract, assets: [{ productionAssetId: identifier,
      checksum: sha256(content), fileSizeBytes: content.length, mimeType, storageBucket: "production-assets", storagePath: "media/source" }] });
    if (legacyVideo) {
      source.previewHtml = legacyCrossfade
        ? source.previewHtml.replace("window.__courseforgeAudioEnvelopeVersion = 2;", "window.__courseforgeAudioEnvelopeVersion = 1;")
        : source.previewHtml.replace('document.getElementById(automation.targetClipId + "-audio")', 'document.getElementById(automation.targetClipId)');
      source.metadata.previewSha256 = sha256(Buffer.from(source.previewHtml));
    }
    const zip = new JSZip();
    for (const [name, bytes] of [["conformance-preview.html", source.previewHtml], ["composition-document.json", source.documentJson],
      ["conformance-contract.json", source.contractJson], ["conformance-reference.json", JSON.stringify(source.metadata)], ["font-manifest.json", "[]"]]) zip.file(name!, bytes!);
    const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
    materialized = await materializeConformanceReference({ archiveBytes, expectedProjectHash: sha256(archiveBytes),
      organizationId: identifier, revisionId: identifier, outputParentDirectory: parent,
      readAsset: async () => new Response(Uint8Array.from(content), { headers: { "Content-Type": mimeType } }) });
    await run(materialized, parent);
  } finally { await materialized?.cleanup(); assert.deepEqual(await readdir(parent), []); await rmdir(parent); }
}
test("authorized materialization produces checksum-bound audio and comparator metadata with owned cleanup", async () => {
  await withMaterialized(async (materialized, parent) => {
    const audio = await createMaterializedAudioReference({ materialized, outputParentDirectory: parent, ffmpegPath: "controlled" }, async () => pcm());
    try {
      const bytes = await readFile(audio.audioReferencePath);
      assert.equal(sha256(bytes), audio.receipt.audioSha256); assert.equal(audio.receipt.decodedAssetCount, 1);
      assert.equal(audio.receipt.status, "SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE");
      assert.deepEqual(JSON.parse(await readFile(audio.audioReferenceMetadataPath, "utf8")),
        { documentHash: materialized.receipt.documentHash, audioSha256: sha256(bytes) });
    } finally { await audio.cleanup(); await audio.cleanup(); }
  });
});
test("modified pinned source fails before decoding or producing an audio workspace", async () => {
  await withMaterialized(async (materialized, parent) => {
    await writeFile(join(materialized.directory, "conformance-media", identifier), "changed"); let decoded = false;
    await assert.rejects(createMaterializedAudioReference({ materialized, outputParentDirectory: parent, ffmpegPath: "controlled" },
      async () => { decoded = true; return pcm(); }), /SOURCE_CHANGED/);
    assert.equal(decoded, false); assert.equal((await readdir(parent)).length, 1);
  });
});

test("productor largo requiere opt-in, escribe WAV completo por chunks y mantiene formato corto v1", async () => {
  await withMaterialized(async (materialized, parent) => {
    let decoded = false;
    const params = { materialized, outputParentDirectory: parent, ffmpegPath: "controlled" };
    await assert.rejects(createMaterializedAudioReference(params, async () => { decoded = true; return pcm(); }), /LONG_AUDIO_UNSUPPORTED/);
    assert.equal(decoded, false); assert.equal((await readdir(parent)).length, 1);
    const audio = await createMaterializedAudioReference({ ...params, allowLongAudio: true }, async () => pcm());
    try {
      const wav = await readFile(audio.audioReferencePath);
      assert.equal(wav.length, 44 + 300 * 8000 * 8); assert.equal(sha256(wav), audio.receipt.audioSha256);
      assert.equal(audio.receipt.schemaVersion, 2); assert.equal(audio.receipt.method, "PREVIEW_RULES_STEREO_PCM_CHUNKED_V2");
      assert.equal(audio.receipt.durationSeconds, 300); assert.equal(wav.readFloatLE(wav.length - 4), 0);
    } finally { await audio.cleanup(); }
  }, false, false, 300);
});
test("decoder failure or source changed during decoding leaves no reference workspace", async () => {
  await withMaterialized(async (materialized, parent) => {
    await assert.rejects(createMaterializedAudioReference({ materialized, outputParentDirectory: parent, ffmpegPath: "controlled" },
      async () => { throw new Error("controlled codec failure"); }), /codec failure/);
    await assert.rejects(createMaterializedAudioReference({ materialized, outputParentDirectory: parent, ffmpegPath: "controlled" },
      async (path) => { await writeFile(path, Buffer.alloc(content.length)); return pcm(); }), /SOURCE_CHANGED/);
    assert.equal((await readdir(parent)).length, 1);
  });
});
test("old frozen video automation cannot masquerade as the corrected preview mix", async () => {
  await withMaterialized(async (materialized, parent) => {
    let decoded = false;
    await assert.rejects(createMaterializedAudioReference({ materialized, outputParentDirectory: parent, ffmpegPath: "controlled" },
      async () => { decoded = true; return pcm(); }), /LEGACY_VIDEO_AUTOMATION/);
    assert.equal(decoded, false);
  }, true);
});
test("old crossfade snapshot cannot be compared under the new shared envelope policy", async () => {
  await withMaterialized(async (materialized, parent) => {
    let decoded = false;
    await assert.rejects(createMaterializedAudioReference({ materialized, outputParentDirectory: parent, ffmpegPath: "controlled" },
      async () => { decoded = true; return pcm(); }), /LEGACY_CROSSFADE_ENVELOPE/);
    assert.equal(decoded, false);
  }, true, true);
});

const comparisonInput = { supabase: {} as never, supabaseUrl: "https://example.supabase.co", organizationId: identifier,
  revisionId: identifier, checksum: "a".repeat(64), outputParentDirectory: "controlled-parent", ffmpegPath: "controlled-ffmpeg",
  videoPath: "integrity-verified-local-video", renderReceiptPath: "internal-receipt" };
function comparisonFixture(failure?: "create" | "compare" | "revision" | "cleanup") {
  const calls: string[] = [];
  const receipt = { organizationId: identifier, revisionId: identifier, projectHash: "b".repeat(64), documentHash: "c".repeat(64),
    status: "SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE" };
  const dependencies = {
    materialize: async () => { calls.push("materialize"); return { receipt, cleanup: async () => { calls.push("cleanup-source"); } }; },
    createAudio: async () => {
      calls.push("create-audio"); if (failure === "create") throw new Error("controlled audio failure");
      return { receipt, audioReferencePath: "verified-audio", audioReferenceMetadataPath: "verified-audio-metadata",
        cleanup: async () => { calls.push("cleanup-audio"); if (failure === "cleanup") throw new Error("controlled cleanup failure"); } };
    },
    compare: async (params: { audioReferencePath: string; audioReferenceMetadataPath: string }) => {
      calls.push("compare"); assert.equal(params.audioReferencePath, "verified-audio");
      assert.equal(params.audioReferenceMetadataPath, "verified-audio-metadata");
      if (failure === "compare") throw new Error("controlled compare failure");
      return { reference: { ...receipt, ...(failure === "revision" ? { projectHash: "d".repeat(64) } : {}) }, report: { status: "FAIL" } };
    },
  } as unknown as NonNullable<Parameters<typeof compareVideoWithSourceAudioReference>[1]>;
  return { calls, dependencies };
}
test("source-audio coordinator connects verified reference to comparison and disposes independent workspaces", async () => {
  const state = comparisonFixture(); const result = await compareVideoWithSourceAudioReference(comparisonInput, state.dependencies);
  assert.equal(result.report.status, "FAIL"); assert.equal(result.audioReference.status, "SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE");
  assert.deepEqual(state.calls, ["materialize", "create-audio", "compare", "cleanup-audio", "cleanup-source"]);
});
test("audio/compare failure or different project cannot hand off a combined result", async () => {
  for (const failure of ["create", "compare", "revision"] as const) {
    const state = comparisonFixture(failure);
    await assert.rejects(compareVideoWithSourceAudioReference(comparisonInput, state.dependencies));
    assert.ok(state.calls.includes("cleanup-source"));
    if (failure !== "create") assert.ok(state.calls.includes("cleanup-audio"));
  }
});
test("audio cleanup failure never skips disposal of materialized media", async () => {
  const state = comparisonFixture("cleanup");
  await assert.rejects(compareVideoWithSourceAudioReference(comparisonInput, state.dependencies), /CLEANUP_FAILED/);
  assert.ok(state.calls.includes("cleanup-source"));
});
