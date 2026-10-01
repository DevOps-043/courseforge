import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { encodeAudioReferenceWav } from "../qa/composition-audio-reference-mix";
import { audioEvidenceSha256, audioEvidenceStoragePath } from "../qa/composition-audio-evidence-contract";
import { persistAudioConformanceEvidence } from "../qa/composition-audio-evidence-persistence";
import { readPersistedAudioConformanceEvidence } from "../qa/composition-audio-evidence-reader";
import { prepareAndPersistAudioConformanceReference } from "../qa/composition-audio-evidence-pipeline";
import { compareVideoWithPersistedConformanceReferences } from "../qa/composition-persisted-audio-comparison";
import { PLAYBACK_CAPTURE_POLICY } from "../qa/composition-playback-capture-runtime";
import { playbackVisualFramesHash } from "../qa/composition-playback-audio-contract";
import { audioTimingReport } from "../qa/composition-exported-audio-timing";
import { playbackBoundaryFixture } from "./composition-playback-test-fixtures";

const identifier = "70000000-0000-4000-8000-000000000001";
const visualChecksum = "c".repeat(64);
async function fixture(run: (input: Awaited<ReturnType<typeof createFixture>>) => Promise<void>, durationSeconds = 3) {
  const input = await createFixture(durationSeconds);
  try { await run(input); } finally {
    for (const name of ["audio-reference.wav", "audio-reference-metadata.json", "audio-reference-receipt.json"]) await rm(join(input.audioDirectory, name), { force: true });
    await rmdir(input.audioDirectory); assert.deepEqual(await readdir(input.outputParentDirectory), []); await rmdir(input.outputParentDirectory);
  }
}
async function createFixture(durationSeconds = 3) {
  const outputParentDirectory = await mkdtemp(join(tmpdir(), "audio-evidence-test-"));
  const audioDirectory = await mkdtemp(join(outputParentDirectory, "source-"));
  const document = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(createInitialCompositionDocument({ animatedDeck: null,
    assets: [{ productionAssetId: identifier, checksum: "f".repeat(64), fileSizeBytes: 100, durationSeconds: 3, mimeType: "audio/wav",
      hasAudio: true, publicUrl: null, storageBucket: "production-assets", storagePath: "media/source", timelineRole: "VOICE" }],
    plan: { accentColor: "#38BDF8", durationSeconds, subtitle: "Evidence", title: "Audio evidence" } }))));
  document.canvas.durationSeconds = durationSeconds;
  const contract = buildCompositionConformanceContract({ document, documentHash: hashCompositionDocument(document),
    assets: [{ id: identifier, checksum: "f".repeat(64) }], renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" } });
  const pcm = Buffer.alloc(durationSeconds * 8000 * 8); for (let index = 0; index < pcm.length; index += 4) pcm.writeFloatLE(0.25, index);
  const wav = encodeAudioReferenceWav(pcm);
  const receipt = { ...(durationSeconds > 120 ? { schemaVersion: 2, method: "PREVIEW_RULES_STEREO_PCM_CHUNKED_V2", mixChunkFrames: 80000 }
    : { schemaVersion: 1, method: "PREVIEW_RULES_STEREO_PCM_V1" }), organizationId: identifier, revisionId: identifier, projectHash: "a".repeat(64),
    documentHash: contract.documentHash, status: "SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE",
    audioEnvelopeVersion: 2, audioSha256: audioEvidenceSha256(wav), assetCount: 1, mediaBytes: 100,
    durationSeconds, sampleRate: 8000, channels: 2, clipCount: 1, decodedAssetCount: 1, peak: 0.25 };
  await writeFile(join(audioDirectory, "audio-reference.wav"), wav);
  await writeFile(join(audioDirectory, "audio-reference-receipt.json"), JSON.stringify(receipt));
  await writeFile(join(audioDirectory, "audio-reference-metadata.json"), JSON.stringify({ documentHash: receipt.documentHash, audioSha256: receipt.audioSha256 }));
  return { audioDirectory, outputParentDirectory, receipt, contract, wav, organizationId: identifier, revisionId: identifier, visualChecksum };
}
function database(input: Awaited<ReturnType<typeof createFixture>>, options: {
  uploadError?: boolean; corrupt?: boolean; downloadError?: boolean; recordError?: boolean; foreignVisual?: boolean; audioRecordPatch?: Record<string, unknown>;
} = {}) {
  let stored: Buffer | null = null; let record: Record<string, unknown> | null = null; const calls: string[] = [];
  const supabase = { rpc: async (name: string, parameters: Record<string, unknown>) => {
    calls.push(name); assert.equal(parameters.p_organization_id, identifier); assert.equal(parameters.p_revision_id, identifier);
    if (name === "read_hyperframes_visual_conformance_evidence") return { error: null, data: {
      organizationId: options.foreignVisual ? "80000000-0000-4000-8000-000000000001" : identifier,
      revisionId: identifier, checksum: visualChecksum, projectHash: input.receipt.projectHash, documentHash: input.receipt.documentHash, contract: input.contract,
      frames: input.contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds, sha256: "9".repeat(64), sizeBytes: 100})) } };
    if (name === "record_hyperframes_audio_conformance_evidence") {
      if (options.recordError) return { error: { message: "private failure" }, data: null };
      record = { organizationId: identifier, revisionId: identifier, visualChecksum, checksum: parameters.p_bundle_sha256,
        projectHash: input.receipt.projectHash, documentHash: input.receipt.documentHash, contract: input.contract,
        storagePath: audioEvidenceStoragePath(identifier, identifier, visualChecksum, parameters.p_bundle_sha256 as string),
        sizeBytes: parameters.p_file_size_bytes, receipt: parameters.p_receipt };
      return { error: null, data: parameters.p_bundle_sha256 };
    }
    assert.equal(name, "read_hyperframes_audio_conformance_evidence");
    assert.equal(parameters.p_visual_checksum, visualChecksum);
    return { error: null, data: record ? { ...record, ...options.audioRecordPatch } : null };
  }, storage: { from: (bucket: string) => {
    assert.equal(bucket, "composition-conformance-evidence");
    return { upload: async (_path: string, bytes: Buffer, settings: unknown) => {
      calls.push("upload"); assert.deepEqual(settings, { contentType: "application/zip", upsert: false }); stored = bytes;
      return { error: options.uploadError ? { message: "lost acknowledgement" } : null };
    }, download: async () => {
      calls.push("download"); return { error: options.downloadError ? { message: "private failure" } : null,
        data: stored ? new Blob([Uint8Array.from(options.corrupt ? Buffer.alloc(stored.length) : stored)]) : null };
    } };
  } } };
  return { supabase: supabase as never, calls, bytes: () => stored!, replaceArchive(bytes: Buffer) {
    stored = bytes; record = { ...record!, checksum: audioEvidenceSha256(bytes), sizeBytes: bytes.length,
      storagePath: audioEvidenceStoragePath(identifier, identifier, visualChecksum, audioEvidenceSha256(bytes)) };
    return audioEvidenceSha256(bytes);
  } };
}
const persist = (input: Awaited<ReturnType<typeof createFixture>>, db: ReturnType<typeof database>) => persistAudioConformanceEvidence({ ...input, supabase: db.supabase });
const read = (input: Awaited<ReturnType<typeof createFixture>>, db: ReturnType<typeof database>, checksum: string) => readPersistedAudioConformanceEvidence({ ...input, supabase: db.supabase, checksum });

test("deterministic private package is linked to visual evidence and registered after exact readback", async () => {
  await fixture(async (input) => {
    const db = database(input); const first = await persist(input, db); const second = await persist(input, db);
    assert.equal(first.checksum, second.checksum); assert.equal(first.receipt.visualChecksum, visualChecksum);
    assert.deepEqual(db.calls.slice(0, 4), ["read_hyperframes_visual_conformance_evidence", "upload", "download", "record_hyperframes_audio_conformance_evidence"]);
    assert.equal(Object.keys((await JSZip.loadAsync(db.bytes())).files).length, 3);
  });
});
test("evidencia playback v3 persiste/lee PCM canónico y rechaza pin visual ajeno", async () => {
  await fixture(async (input) => {
    const visualFrames = input.contract.checkpoints.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds, sha256: "9".repeat(64), sizeBytes: 100}));
    const receipt = {...input.receipt, schemaVersion: 3, method: "BROWSER_MEDIA_OUTPUT_PCM_CANONICAL_V3", status: "BROWSER_PLAYBACK_CAPTURED",
      decodedAssetCount: 0, conversion: "FFMPEG_ARESAMPLE_8K_STEREO_NO_GAIN_OR_LAG_CORRECTION", visualFrames,
      visualFramesSha256: playbackVisualFramesHash(visualFrames), native: {sampleRate: 48000, audioSha256: "e".repeat(64), peak: 0.25},
      playback: {policy: PLAYBACK_CAPTURE_POLICY.id, workletSha256: "d".repeat(64), originFrame: 0, sampleCount: input.receipt.durationSeconds * 48000,
        packetCount: 100, eventCount: 50, maxClockDriftMilliseconds: 2, maxMediaDriftMilliseconds: 2, quantumMilliseconds: 128000 / 48000,
        observation: "BROWSER_MEDIA_GRAPH_NOT_PHYSICAL_DEVICE_OR_SEMANTIC_LIP_SYNC"}};
    await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify(receipt));
    const db = database(input); const saved = await persist(input, db); const loaded = await read(input, db, saved.checksum);
    try {assert.equal(loaded.receipt.schemaVersion, 3); assert.equal(loaded.receipt.status, "BROWSER_PLAYBACK_CAPTURED");}
    finally {await loaded.cleanup();}
    const changedFrames = visualFrames.map((frame) => ({...frame, sha256: "8".repeat(64)}));
    await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify({...receipt, visualFrames: changedFrames,
      visualFramesSha256: playbackVisualFramesHash(changedFrames)}));
    const rejected = database(input);
    await assert.rejects(persist(input, rejected), /PLAYBACK_VISUAL_MISMATCH/);
    assert.ok(!rejected.calls.includes("upload"));
  });
});

test("lost acknowledgement recovers only if existing storage bytes match", async () => {
  await fixture(async (input) => {
    await persist(input, database(input, { uploadError: true }));
    const db = database(input, { uploadError: true, corrupt: true });
    await assert.rejects(persist(input, db), /STORAGE_MISMATCH/); assert.ok(!db.calls.includes("record_hyperframes_audio_conformance_evidence"));
  });
});

test("v2 persiste y lee WAV de 5 minutos sin ampliar semántica de recibos v1", async () => {
  await fixture(async (input) => {
    for (const change of [{ schemaVersion: 1, method: "PREVIEW_RULES_STEREO_PCM_V1" }, { mixChunkFrames: 80001 }]) {
      await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify({ ...input.receipt, ...change }));
      const rejected = database(input);
      await assert.rejects(persist(input, rejected)); assert.ok(!rejected.calls.includes("upload"));
    }
    await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify(input.receipt));
    const db = database(input), stored = await persist(input, db), loaded = await read(input, db, stored.checksum);
    try {
      assert.equal(loaded.receipt.schemaVersion, 2); assert.equal(loaded.receipt.durationSeconds, 300);
      assert.deepEqual(await readFile(loaded.audioReferencePath), input.wav);
      assert.equal(stored.checksum, (await persist(input, db)).checksum);
    } finally { await loaded.cleanup(); }
  }, 300);
});
test("foreign visual context, different duration/peak or modified WAV fail before upload", async () => {
  await fixture(async (input) => {
    await assert.rejects(persist(input, database(input, { foreignVisual: true })), /CONTEXT_MISMATCH/);
    for (const change of [{ durationSeconds: 2 }, { peak: 0.9 }, { audioEnvelopeVersion: 1 }]) {
      await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify({ ...input.receipt, ...change }));
      const db = database(input); await assert.rejects(persist(input, db)); assert.ok(!db.calls.includes("upload"));
    }
    await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify(input.receipt));
    await writeFile(join(input.audioDirectory, "audio-reference.wav"), "changed");
    const db = database(input); await assert.rejects(persist(input, db), /CONTENT_MISMATCH/); assert.ok(!db.calls.includes("upload"));
  });
});
test("readback or RPC failures keep the uploaded object for safe retry without approving it", async () => {
  await fixture(async (input) => {
    for (const options of [{ downloadError: true }, { recordError: true }]) {
      const db = database(input, options); await assert.rejects(persist(input, db), /READBACK_FAILED|RECORD_FAILED/); assert.ok(db.bytes().length > 0);
    }
  });
});
test("valid hash cannot disguise a malformed WAV header or non-finite sample", async () => {
  await fixture(async (input) => {
    for (const variant of ["header", "nan"]) {
      const wav = Buffer.from(input.wav);
      if (variant === "header") wav.writeUInt16LE(1, 22); else wav.writeFloatLE(Number.NaN, 44);
      const checksum = audioEvidenceSha256(wav);
      await writeFile(join(input.audioDirectory, "audio-reference.wav"), wav);
      await writeFile(join(input.audioDirectory, "audio-reference-receipt.json"), JSON.stringify({ ...input.receipt, audioSha256: checksum }));
      await writeFile(join(input.audioDirectory, "audio-reference-metadata.json"), JSON.stringify({ documentHash: input.receipt.documentHash, audioSha256: checksum }));
      const db = database(input); await assert.rejects(persist(input, db), /WAV_INVALID|PCM_INVALID/);
      assert.ok(!db.calls.includes("upload"));
    }
  });
});
test("reader validates WAV and metadata and supports idempotent owned cleanup", async () => {
  await fixture(async (input) => {
    const db = database(input); const persisted = await persist(input, db); const audio = await read(input, db, persisted.checksum);
    try { assert.deepEqual(await readFile(audio.audioReferencePath), input.wav); assert.equal(audio.receipt.visualChecksum, visualChecksum); }
    finally { await audio.cleanup(); await audio.cleanup(); }
  });
});
test("reader rejects mismatched scope or path before downloading", async () => {
  await fixture(async (input) => {
    for (const patch of [{ organizationId: "80000000-0000-4000-8000-000000000001" }, { revisionId: "80000000-0000-4000-8000-000000000001" },
      { visualChecksum: "d".repeat(64) }, { storagePath: "../outside.zip" }]) {
      const db = database(input, { audioRecordPatch: patch }); const persisted = await persist(input, db); const before = db.calls.length;
      await assert.rejects(read(input, db, persisted.checksum), /CONTEXT_MISMATCH/);
      assert.deepEqual(db.calls.slice(before), ["read_hyperframes_audio_conformance_evidence"]);
    }
  });
});
test("reader requires a recorded object and hashes bytes before decompression", async () => {
  await fixture(async (input) => {
    await assert.rejects(read(input, database(input), "a".repeat(64)), /RECORD_UNAVAILABLE/);
    const db = database(input); const persisted = await persist(input, db); db.bytes().fill(0);
    await assert.rejects(read(input, db, persisted.checksum), /STORAGE_MISMATCH/);
  });
});
test("extra files, traversal and expansion limit fail even for a hash-registered archive", async () => {
  await fixture(async (input) => {
    const db = database(input); await persist(input, db); const original = Buffer.from(db.bytes());
    for (const variant of ["extra", "traversal", "oversize"]) {
      const zip = await JSZip.loadAsync(original);
      if (variant === "extra") zip.file("unexpected.txt", "extra");
      else if (variant === "traversal") { zip.remove("audio-reference.wav"); zip.file("../audio-reference.wav", input.wav, { createFolders: false }); }
      else zip.file("audio-reference-metadata.json", Buffer.alloc(65537));
      const checksum = db.replaceArchive(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      await assert.rejects(read(input, db, checksum), /ARCHIVE_INVALID|EXTRACTION_LIMIT/);
    }
  });
});
test("changed receipt or WAV is independently rejected after package hash matches", async () => {
  await fixture(async (input) => {
    const db = database(input); await persist(input, db); const original = Buffer.from(db.bytes());
    for (const variant of ["receipt", "wav"]) {
      const zip = await JSZip.loadAsync(original);
      if (variant === "receipt") zip.file("audio-reference-receipt.json", JSON.stringify({ ...input.receipt, visualChecksum, peak: 0.9 }));
      else zip.file("audio-reference.wav", Buffer.alloc(input.wav.length));
      const checksum = db.replaceArchive(await zip.generateAsync({ type: "nodebuffer" }));
      await assert.rejects(read(input, db, checksum), /RECEIPT_MISMATCH|CONTENT_MISMATCH/);
    }
  });
});

const pipelineInput = { supabase: {} as never, supabaseUrl: "https://example.supabase.co", organizationId: identifier,
  revisionId: identifier, visualChecksum, ffmpegPath: "controlled", outputParentDirectory: "controlled-parent" };
test("pipeline persists generated audio only and cleans up both stages on success or persistence failure", async () => {
  for (const failure of [false, true]) {
    const calls: string[] = [];
    const dependencies = { materialize: async () => ({ cleanup: async () => { calls.push("cleanup-source"); } }),
      createAudio: async () => ({ directory: "generated-audio", cleanup: async () => { calls.push("cleanup-audio"); } }),
      persist: async (params: { audioDirectory: string }) => {
        assert.equal(params.audioDirectory, "generated-audio"); calls.push("persist"); if (failure) throw new Error("controlled failure"); return {};
      } } as unknown as NonNullable<Parameters<typeof prepareAndPersistAudioConformanceReference>[1]>;
    if (failure) await assert.rejects(prepareAndPersistAudioConformanceReference(pipelineInput, dependencies));
    else await prepareAndPersistAudioConformanceReference(pipelineInput, dependencies);
    assert.deepEqual(calls, ["persist", "cleanup-audio", "cleanup-source"]);
  }
});
test("persisted-pair comparator receives verified paths and closes audio for result/failure/mismatch", async () => {
  for (const failure of ["none", "compare", "revision", "cleanup", "skipped", "visual", "rms-skipped", "rms-failed"]) {
    let cleaned = false; const receipt = { organizationId: identifier, revisionId: identifier, projectHash: "b".repeat(64), documentHash: "d".repeat(64), visualChecksum };
    const dependencies = { readAudio: async (params: { visualChecksum: string; checksum: string }) => {
      assert.equal(params.visualChecksum, visualChecksum); assert.equal(params.checksum, "a".repeat(64));
      return { checksum: params.checksum, receipt, audioReferencePath: "verified-wav", audioReferenceMetadataPath: "verified-metadata",
        cleanup: async () => { cleaned = true; if (failure === "cleanup") throw new Error("controlled cleanup failure"); } };
    }, compare: async (params: { audioReferencePath: string }) => {
      assert.equal(params.audioReferencePath, "verified-wav"); if (failure === "compare") throw new Error("controlled compare failure");
      return { reference: { ...receipt, checksum: failure === "visual" ? "f".repeat(64) : visualChecksum,
        ...(failure === "revision" ? { projectHash: "c".repeat(64) } : {}) },
        report: { status: failure.startsWith("rms-") ? "PASS" : "FAIL",
          audioTiming: { status: failure === "skipped" ? "NOT_REQUESTED" : failure.startsWith("rms-") ? "PASS" : "FAIL",
            ...(failure === "rms-failed" ? { rms: { status: "FAIL" } } : {}) } } };
    } } as unknown as NonNullable<Parameters<typeof compareVideoWithPersistedConformanceReferences>[1]>;
    const input = { ...pipelineInput, checksum: visualChecksum, audioChecksum: "a".repeat(64), videoPath: "verified-video", renderReceiptPath: "internal-receipt" };
    if (failure === "none") assert.equal((await compareVideoWithPersistedConformanceReferences(input, dependencies)).report.status, "FAIL");
    else await assert.rejects(compareVideoWithPersistedConformanceReferences(input, dependencies));
    assert.equal(cleaned, true);
  }
});
test("coordinador playback mantiene INCOMPLETE/FAIL del gate aunque métricas del MP4 pasen", async () => {
  for (const [drift, expected] of [[2, "PASS"], [15, "INCOMPLETE"], [40, "FAIL"]] as const) {
    let cleaned = false;
    const receipt = {schemaVersion: 3, clipCount: 1, organizationId: identifier, revisionId: identifier, projectHash: "b".repeat(64),
      documentHash: "d".repeat(64), visualChecksum, playback: {policy: PLAYBACK_CAPTURE_POLICY.id, workletSha256: "e".repeat(64),
        originFrame: 0, sampleCount: 48000, packetCount: 500, eventCount: 20, quantumMilliseconds: 128000 / 48000,
        maxClockDriftMilliseconds: drift, maxMediaDriftMilliseconds: 2, observation: "BROWSER_MEDIA_GRAPH_NOT_PHYSICAL_DEVICE_OR_SEMANTIC_LIP_SYNC",
        boundaries: playbackBoundaryFixture(1)}};
    const dependencies = {readAudio: async () => ({receipt, contract: {canvas: {fps: 25}}, checksum: "a".repeat(64),
      audioReferencePath: "verified", audioReferenceMetadataPath: "verified", cleanup: async () => {cleaned = true;}}),
      compare: async () => ({reference: {...receipt, checksum: visualChecksum}, report: {status: "PASS",
        audioTiming: {...audioTimingReport("PASS"), lagMilliseconds: 0, rms: {status: "PASS"}}}})} as never;
    const result = await compareVideoWithPersistedConformanceReferences({...pipelineInput, checksum: visualChecksum,
      audioChecksum: "a".repeat(64), videoPath: "verified", renderReceiptPath: "internal"}, dependencies);
    assert.equal(result.report.status, expected); assert.equal(result.report.audioPlayback?.status, expected);
    assert.equal(result.audioReference.provenance, "SCOPED_WORKER_PLAYBACK_AUDIO_EVIDENCE"); assert.equal(cleaned, true);
  }
});

test("flag playback selecciona productor real y nunca cae silenciosamente al modelo de fuentes", async () => {
  const calls: string[] = [];
  const dependencies = {materialize: async () => ({cleanup: async () => {calls.push("cleanup-source");}}),
    createAudio: async () => {throw new Error("legacy producer must not run");},
    createPlaybackAudio: async () => ({directory: "verified-playback", cleanup: async () => {calls.push("cleanup-audio");}}),
    persist: async (params: {audioDirectory: string}) => {assert.equal(params.audioDirectory, "verified-playback"); calls.push("persist");}} as never;
  await prepareAndPersistAudioConformanceReference({...pipelineInput, capturePlaybackAudio: true}, dependencies);
  assert.deepEqual(calls, ["persist", "cleanup-audio", "cleanup-source"]);
});

test("failed pipeline cleanup does not skip disposal of the independent source workspace", async () => {
  const calls: string[] = [];
  const dependencies = { materialize: async () => ({ cleanup: async () => { calls.push("source"); } }),
    createAudio: async () => ({ directory: "generated-audio", cleanup: async () => { calls.push("audio"); throw new Error("controlled failure"); } }),
    persist: async () => ({}) } as unknown as NonNullable<Parameters<typeof prepareAndPersistAudioConformanceReference>[1]>;
  await assert.rejects(prepareAndPersistAudioConformanceReference(pipelineInput, dependencies), /CLEANUP_FAILED/);
  assert.deepEqual(calls, ["audio", "source"]);
});
