import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseWaveformV2Derivative, parseWaveformV2Manifest } from "../audio-waveform-v2.contract";
import { readAudioWaveformPreview } from "../audio-waveform-read.service";
import { buildAudioWaveformPath } from "../audio-waveform-projection.service";

const organizationId = "00000000-0000-4000-8000-000000000001";
const componentId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const sourceChecksum = "a".repeat(64);
const derivative = { contract_version: 2, sample_rate_hz: 8000, duration_seconds: 4,
  channels: [1, -1].map(() => ({ levels: [{ bucket_size_samples: 8000,
    min: [0.1, 0.2, 0.8, 0.4].map((value) => -value), max: [0.1, 0.2, 0.8, 0.4].map((value) => value) }] })) };
const bytes = Buffer.from(JSON.stringify(derivative));
const checksum = createHash("sha256").update(bytes).digest("hex");
const manifest = { contract_version: 2, checksum, source_checksum: sourceChecksum, sample_rate_hz: 8000,
  duration_seconds: 4, level_count: 1, channel_count: 2, storage_bucket: "production-assets",
  storage_path: `organizations/${organizationId}/audio-analysis/${checksum}/waveform-v2.json` };

function fake(currentChecksum = sourceChecksum) {
  let downloads = 0;
  const query = { select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: { asset_type: "SOURCE_MEDIA", checksum: currentChecksum, qa_status: "APPROVED", metadata: { waveform: manifest } }, error: null }) };
  return { get downloads() { return downloads; }, supabase: { from: () => query,
    storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob([new Uint8Array(bytes)]), error: null }; } }) } } as unknown as Parameters<typeof readAudioWaveformPreview>[0]["supabase"] };
}

test("reads a stereo original without voice processing metadata and projects a zoomed source window", async () => {
  const source = fake();
  const preview = await readAudioWaveformPreview({ organizationId, componentId, assetId, supabase: source.supabase,
    startSeconds: 2, endSeconds: 4, widthPixels: 2 });
  assert.equal(preview.offsetSeconds, 2); assert.equal(preview.channels?.length, 2);
  assert.deepEqual(preview.min, [-0.8, -0.4]);
  assert.equal(buildAudioWaveformPath({ clipDurationSeconds: 2, sourceOffsetSeconds: 2, viewportWidthPixels: 2, waveform: preview }), "M0.5 10.0V90.0M1.5 30.0V70.0");
});

test("rejects stale source fingerprints before accessing storage", async () => {
  const source = fake("b".repeat(64));
  await assert.rejects(readAudioWaveformPreview({ organizationId, componentId, assetId, supabase: source.supabase }), /disponible/);
  assert.equal(source.downloads, 0);
});

test("rejects invalid manifests and mismatched channel pyramids", () => {
  assert.equal(parseWaveformV2Manifest({ ...manifest, checksum: "b".repeat(64) }), null);
  const invalid = structuredClone(derivative); invalid.channels[1].levels[0].max.pop();
  assert.throws(() => parseWaveformV2Derivative(invalid), /LOD_INVALID/);
});
