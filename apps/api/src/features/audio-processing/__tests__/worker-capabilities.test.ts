import assert from "node:assert/strict";
import test from "node:test";
import { processAudioProcessingBatch, processClaimedAudioJob } from "../audio-worker";
import {
  BASE_AUDIO_PROFILE_ID,
  DEEPFILTER_AUDIO_PROFILE_ID,
  supportedAudioProfileIds,
} from "../worker-capabilities";

test("base image claims only the baseline profile", () => {
  assert.deepEqual(supportedAudioProfileIds({}), [BASE_AUDIO_PROFILE_ID]);
});

test("managed neural image claims baseline and DeepFilterNet profiles", () => {
  assert.deepEqual(supportedAudioProfileIds({ DEEPFILTERNET_ENABLED: "true" }), [
    BASE_AUDIO_PROFILE_ID,
    DEEPFILTER_AUDIO_PROFILE_ID,
  ]);
});

test("batch sends its capabilities to the atomic claim RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: [], error: null };
    },
  } as unknown as Parameters<typeof processAudioProcessingBatch>[0];

  const result = await processAudioProcessingBatch(supabase, [BASE_AUDIO_PROFILE_ID], 2);

  assert.deepEqual(result, { claimed: 0, failed: 0 });
  assert.deepEqual(calls, [{
    name: "claim_audio_processing_jobs_by_profile",
    args: { p_lease_seconds: 900, p_limit: 2, p_profile_ids: [BASE_AUDIO_PROFILE_ID] },
  }]);
});

test("empty capability list fails before claiming a job", async () => {
  const supabase = { rpc: () => { throw new Error("unexpected RPC"); } } as unknown as
    Parameters<typeof processAudioProcessingBatch>[0];
  await assert.rejects(processAudioProcessingBatch(supabase, []), /AUDIO_PROCESSING_PROFILES_REQUIRED/);
});

test("worker rejects an unsupported claimed profile before downloading audio", async () => {
  let downloads = 0;
  const rpcCalls: string[] = [];
  const supabase = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return { data: null, error: null };
    },
    storage: { from: () => ({ download: async () => { downloads += 1; return { data: null, error: null }; } }) },
  } as unknown as Parameters<typeof processClaimedAudioJob>[0]["supabase"];
  const job = {
    artifact_id: "00000000-0000-4000-8000-000000000001",
    audio_processing_lease_token: "00000000-0000-4000-8000-000000000002",
    id: "00000000-0000-4000-8000-000000000003",
    input_snapshot: {
      profile: { id: DEEPFILTER_AUDIO_PROFILE_ID, version: 1 },
      source: {
        assetId: "00000000-0000-4000-8000-000000000004",
        checksum: "a".repeat(64),
        mimeType: "audio/wav",
        storageBucket: "production-assets",
        storagePath: "test.wav",
      },
    },
    organization_id: "00000000-0000-4000-8000-000000000005",
  };

  await assert.rejects(
    processClaimedAudioJob({ job, supabase, supportedProfiles: [BASE_AUDIO_PROFILE_ID] }),
    /AUDIO_PROCESSING_PROFILE_UNSUPPORTED_BY_WORKER/,
  );
  assert.equal(downloads, 0);
  assert.deepEqual(rpcCalls, ["fail_audio_processing_job"]);
});
