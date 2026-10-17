import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAudioProcessingJobInput, resolveAudioProcessingSource } from "../audio-processing-job.service";
import { resolveAudioStorageSource, normalizeAudioSourceMime } from "../audio-source-contract";
import { getAudioSourceCapability } from "../audio-source-policy";
import { resolveImportedAudioFormat } from "../audio-source-format";
import { isRelatedAudioProcessingReplacement } from "../audio-replacement-policy";

const voice = {
  id: "f81d4fae-7dec-4a08-bd4b-5d2b2b6d0c44", asset_type: "VOICE_AUDIO", checksum: "a".repeat(64),
  file_size_bytes: 1024, material_component_id: "4fbcd2af-f3ea-42cd-95fe-f822d201273d", mime_type: "audio/mpeg",
  organization_id: "d4f0864e-508d-4ae3-9072-7ea2a0bf43e8", storage_bucket: "production-assets",
  storage_path: "production-assets/heygen/voice.mp3", qa_status: "READY_FOR_QA",
};

test("accepts HeyGen and synchronized/detached voice without reclassifying the registry", () => {
  for (const metadata of [{ timeline_role: "VOICE" }, { import_type: "voice" }]) {
    const source = { ...voice, asset_type: "SOURCE_MEDIA", metadata };
    assert.equal(buildAudioProcessingJobInput(source).source.storagePath, "heygen/voice.mp3");
    assert.equal(source.asset_type, "SOURCE_MEDIA");
  }
  assert.equal(getAudioSourceCapability(voice).eligible, true);
});

test("rejects music, unclassified media, archived assets, bad checksum and oversized audio", () => {
  for (const override of [
    { asset_type: "SOURCE_MEDIA", metadata: { timeline_role: "MUSIC" } }, { asset_type: "SOURCE_MEDIA" },
    { qa_status: "ARCHIVED" }, { qa_status: "REJECTED" }, { checksum: null }, { file_size_bytes: 50 * 1024 * 1024 + 1 },
  ]) assert.equal(getAudioSourceCapability({ ...voice, ...override }).eligible, false);
});

test("canonical storage and MIME give equivalent idempotency inputs", () => {
  assert.deepEqual(buildAudioProcessingJobInput(voice), buildAudioProcessingJobInput({ ...voice, storage_path: "heygen/voice.mp3", mime_type: "audio/mp3" }));
  for (const mime of ["audio/mp4", "audio/aac", "audio/x-m4a; charset=binary", "audio/wave"]) {
    assert.ok(normalizeAudioSourceMime(mime));
    assert.equal(getAudioSourceCapability({ ...voice, mime_type: mime }).eligible, true);
  }
});

test("rejects unsafe storage identities without broadening bucket access", () => {
  for (const path of ["", "/voice.wav", "https://host/voice.wav", "C:\\voice.wav", "../voice.wav", "heygen/../voice.wav", "heygen/%2e%2e/voice.wav", "production-assets/production-assets/voice.wav", "sound-effect-assets/voice.wav"]) {
    assert.throws(() => resolveAudioStorageSource("production-assets", path));
  }
  assert.throws(() => resolveAudioStorageSource("private-files", "voice.wav"));
});

test("detects binary HeyGen formats and rejects disguised/non-audio payloads", () => {
  const fixtures = [
    [Buffer.from("ID3voice"), "audio/mpeg", "mp3"],
    [Buffer.from("RIFF0000WAVEvoice"), "audio/wav", "wav"],
    [Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]), "audio/mp4", "m4a"],
    [Buffer.from([255, 241, 80, 128, 0, 255, 252]), "audio/aac", "aac"],
  ] as const;
  for (const [bytes, mime, extension] of fixtures) {
    assert.deepEqual(resolveImportedAudioFormat("application/octet-stream", bytes), { contentType: mime, extension });
    assert.equal(resolveImportedAudioFormat(mime, bytes).extension, extension);
  }
  assert.throws(() => resolveImportedAudioFormat("audio/mpeg", Buffer.from("<html>error</html>")));
  assert.throws(() => resolveImportedAudioFormat("audio/mpeg", fixtures[1][0]));
});

test("paired-scene replacement requires a passing derivative of the exact original component", () => {
  const original = { id: voice.id, asset_type: "SOURCE_MEDIA", provider: "manual", material_component_id: voice.material_component_id, mime_type: "audio/mpeg", metadata: null };
  const processed = { ...original, id: "processed", asset_type: "PROCESSED_AUDIO", provider: "ffmpeg", mime_type: "audio/mp4", metadata: { source_asset_id: original.id, audio_analysis: { passed: true } } };
  assert.equal(isRelatedAudioProcessingReplacement(original, processed), true);
  assert.equal(isRelatedAudioProcessingReplacement(processed, original), true);
  assert.equal(isRelatedAudioProcessingReplacement(original, { ...processed, material_component_id: "other" }), false);
  assert.equal(isRelatedAudioProcessingReplacement(original, { ...processed, metadata: { source_asset_id: original.id, audio_analysis: { passed: false } } }), false);
  assert.equal(isRelatedAudioProcessingReplacement(original, { ...processed, provider: "manual" }), false);
});

test("web and separately deployed API worker use the same source contract", () => {
  const web = readFileSync(resolve("src/domains/production/audio-processing/audio-source-contract.ts"), "utf8");
  const api = readFileSync(resolve("../api/src/features/audio-processing/audio-source-contract.ts"), "utf8");
  assert.equal(web.replaceAll("\r\n", "\n"), api.replaceAll("\r\n", "\n"));
});

test("resolves originals through tenant and component filters and rejects foreign or cyclic derivatives", async () => {
  let records: Record<string, typeof voice & { metadata?: unknown }> = { [voice.id]: voice };
  const filteredColumns: string[] = [];
  const supabase = { from: () => {
    const filters: Record<string, string> = {};
    const query = { select: () => query, eq: (field: string, value: string) => { filteredColumns.push(field); filters[field] = value; return query; },
      maybeSingle: async () => {
        const row = records[filters.id];
        return { data: row && row.organization_id === filters.organization_id && row.material_component_id === filters.material_component_id ? row : null, error: null };
      } };
    return query;
  } };
  const params = { componentId: voice.material_component_id, organizationId: voice.organization_id, sourceAssetId: voice.id, supabase: supabase as never };
  assert.equal((await resolveAudioProcessingSource(params)).id, voice.id);
  await assert.rejects(() => resolveAudioProcessingSource({ ...params, organizationId: "foreign" }), /no encontrada/);
  const derivativeId = "18335cbe-52e0-4ef7-94e2-6a4e2cd4f296";
  records[derivativeId] = { ...voice, id: derivativeId, asset_type: "PROCESSED_AUDIO", metadata: { source_asset_id: voice.id } };
  assert.equal((await resolveAudioProcessingSource({ ...params, sourceAssetId: derivativeId })).id, voice.id);
  records = { ...records, [voice.id]: { ...voice, asset_type: "PROCESSED_AUDIO", metadata: { source_asset_id: derivativeId } } };
  await assert.rejects(() => resolveAudioProcessingSource({ ...params, sourceAssetId: derivativeId }), /no referencia una narración original/);
  assert.ok(filteredColumns.includes("organization_id") && filteredColumns.includes("material_component_id"));
});
