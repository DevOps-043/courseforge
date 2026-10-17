import assert from "node:assert/strict";
import test from "node:test";
import { validateAudioSourceProbe, MAX_AUDIO_DURATION_SECONDS } from "../audio-source-probe";
import { resolveAudioStorageSource } from "../audio-source-contract";
import { processClaimedAudioJob } from "../audio-worker";
import type { SupabaseClient } from "@supabase/supabase-js";

const probe = { format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "14.321" }, streams: [{ codec_type: "audio", codec_name: "aac" }] };
test("accepts a real audio container without rounding its fractional duration", () => {
  assert.equal(validateAudioSourceProbe(probe), 14.321);
  for (const [container, codec] of [["mp3", "mp3"], ["wav", "pcm_s16le"], ["aac", "aac"]]) {
    assert.equal(validateAudioSourceProbe({ format: { format_name: container, duration: "2.5" }, streams: [{ codec_type: "audio", codec_name: codec }] }), 2.5);
  }
});
test("rejects silent video, unsupported codec/container and unbounded duration", () => {
  assert.throws(() => validateAudioSourceProbe({ ...probe, streams: [] }), /HAS_NO_AUDIO/);
  assert.throws(() => validateAudioSourceProbe({ ...probe, streams: [...probe.streams, { codec_type: "video", codec_name: "h264" }] }), /VIDEO_NOT_SUPPORTED/);
  assert.throws(() => validateAudioSourceProbe({ ...probe, streams: [{ codec_type: "audio", codec_name: "opus" }] }), /CODEC_UNSUPPORTED/);
  for (const duration of ["NaN", "Infinity", "0", "-1", String(MAX_AUDIO_DURATION_SECONDS + 1)]) {
    assert.throws(() => validateAudioSourceProbe({ ...probe, format: { ...probe.format, duration } }), /DURATION/);
  }
});
test("legacy worker snapshots resolve the object path rather than duplicating the bucket", () => {
  assert.deepEqual(resolveAudioStorageSource("production-assets", "production-assets/heygen/voice.mp3"), { storageBucket: "production-assets", storagePath: "heygen/voice.mp3" });
});

test("caps automatic retries and records malformed claimed inputs as terminal failures", async () => {
  const job = {
    id: "18335cbe-52e0-4ef7-94e2-6a4e2cd4f296", artifact_id: "18335cbe-52e0-4ef7-94e2-6a4e2cd4f296",
    organization_id: "d4f0864e-508d-4ae3-9072-7ea2a0bf43e8", audio_processing_lease_token: "91ee2ece-eb0e-4273-a727-c8c731a83b89",
    input_snapshot: {profile:{id:"voice-course-v1",version:1},source:{assetId:"18335cbe-52e0-4ef7-94e2-6a4e2cd4f296",checksum:"a".repeat(64),mimeType:"audio/mpeg",storageBucket:"production-assets",storagePath:"heygen/voice.mp3"}},
  };
  const failures: Array<Record<string, unknown>> = [];
  const supabase = { storage: {from: () => ({download: async () => ({data:null,error:new Error("unavailable")})})}, rpc: async (_name: string, args: Record<string,unknown>) => { failures.push(args); return {error:null}; } } as unknown as SupabaseClient<any, any, any>;
  for (const attempt of [1, 3]) {
    await assert.rejects(() => processClaimedAudioJob({job:{...job,audio_processing_attempts:attempt},supabase,supportedProfiles:["voice-course-v1"]}), /DOWNLOAD_FAILED/);
    assert.equal(failures.at(-1)?.p_retryable, attempt < 3);
  }
  await assert.rejects(() => processClaimedAudioJob({job:{...job,input_snapshot:{}},supabase,supportedProfiles:["voice-course-v1"]}), /INPUT_INVALID/);
  assert.equal(failures.at(-1)?.p_retryable, false);
});
