import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AudioWaveformReadError, readAudioWaveformPreview } from "../audio-waveform-read.service";

const organizationId = "00000000-0000-4000-8000-000000000001";
const componentId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const derivative = {
  contract_version: 1,
  duration_seconds: 2,
  levels: [{ bucket_size_samples: 1, max: [0.5, 0.75], min: [-0.5, -0.75] }],
  sample_rate_hz: 400,
};
const bytes = Buffer.from(JSON.stringify(derivative));
const checksum = createHash("sha256").update(bytes).digest("hex");

function metadata(tenant = organizationId, hash = checksum) {
  return {
    audio_analysis: {
      contract_version: 1,
      integrated_lufs: -16,
      loudness_range_lu: 3,
      measured_threshold_lufs: -26,
      passed: true,
      target_integrated_lufs: -16,
      target_true_peak_dbtp: -1.5,
      tolerance_lu: 1,
      true_peak_dbtp: -1.3,
    },
    waveform: {
      checksum: hash,
      contract_version: 1,
      duration_seconds: 2,
      level_count: 1,
      sample_rate_hz: 400,
      storage_bucket: "production-assets",
      storage_path: `organizations/${tenant}/audio-analysis/${hash}/waveform-v1.json`,
    },
  };
}

function fakeSupabase(assetMetadata: unknown, content = bytes) {
  const filters: Array<[string, string]> = [];
  let downloads = 0;
  const query = {
    select: () => query,
    eq: (name: string, value: string) => { filters.push([name, value]); return query; },
    maybeSingle: async () => ({ data: { asset_type: "PROCESSED_AUDIO", metadata: assetMetadata }, error: null }),
  };
  const supabase = {
    from: () => query,
    storage: { from: () => ({ download: async () => {
      downloads += 1;
      return { data: new Blob([new Uint8Array(content)]), error: null };
    } }) },
  } as unknown as Parameters<typeof readAudioWaveformPreview>[0]["supabase"];
  return { filters, get downloads() { return downloads; }, supabase };
}

test("reads a checksum-verified waveform through tenant, component and asset filters", async () => {
  const fake = fakeSupabase(metadata());
  const preview = await readAudioWaveformPreview({ assetId, componentId, organizationId, supabase: fake.supabase });
  assert.deepEqual(fake.filters, [
    ["id", assetId],
    ["organization_id", organizationId],
    ["material_component_id", componentId],
    ["asset_type", "PROCESSED_AUDIO"],
  ]);
  assert.equal(fake.downloads, 1);
  assert.deepEqual(preview.min, [-0.5, -0.75]);
});

test("rejects a derivative from another tenant before storage access", async () => {
  const fake = fakeSupabase(metadata("00000000-0000-4000-8000-000000000099"));
  await assert.rejects(
    readAudioWaveformPreview({ assetId, componentId, organizationId, supabase: fake.supabase }),
    (error: unknown) => error instanceof AudioWaveformReadError && error.status === 422,
  );
  assert.equal(fake.downloads, 0);
});

test("rejects derivative bytes whose checksum differs from the manifest", async () => {
  const fake = fakeSupabase(metadata(), Buffer.from("{}"));
  await assert.rejects(
    readAudioWaveformPreview({ assetId, componentId, organizationId, supabase: fake.supabase }),
    /checksum/,
  );
});
