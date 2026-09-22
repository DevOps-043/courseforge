import assert from "node:assert/strict";
import test from "node:test";
import { getAudioProcessingProfile } from "../audio-processing-profiles";
import { resolveAudioProcessingWorkerInput } from "../audio-processing-worker-contracts";

const job = {
  id: "18335cbe-52e0-4ef7-94e2-6a4e2cd4f296",
  input_snapshot: {
    profile: {
      id: "voice-course-v1",
      // A malicious snapshot cannot redefine the worker's FFmpeg chain.
      processing: { loudness: { integratedLufs: 0 } },
      version: 1,
    },
    source: {
      assetId: "91ee2ece-eb0e-4273-a727-c8c731a83b89",
      checksum: "c8e8137af3aee84f2e855113ea5c19c99140774c2459d20ca7147a2da11c3fe4",
      mimeType: "audio/wav",
      storageBucket: "production-assets",
      storagePath: "organizations/org-1/voices/source.wav",
    },
  },
  job_type: "AUDIO_PROCESSING",
  provider: "ffmpeg",
  status: "RUNNING",
};

test("resolves only an allowlisted profile instead of trusting snapshot filters", () => {
  const resolved = resolveAudioProcessingWorkerInput(job);
  assert.equal(resolved.profile, getAudioProcessingProfile("voice-course-v1"));
  assert.equal(resolved.profile.processing.loudness.integratedLufs, -16);
  assert.equal(resolved.source.storagePath, "organizations/org-1/voices/source.wav");
});

test("rejects non-claimed jobs and malformed source identities", () => {
  assert.throws(
    () => resolveAudioProcessingWorkerInput({ ...job, status: "PENDING" }),
    /AUDIO_PROCESSING_JOB_NOT_CLAIMED/,
  );
  assert.throws(
    () => resolveAudioProcessingWorkerInput({
      ...job,
      input_snapshot: {
        ...job.input_snapshot,
        source: { ...job.input_snapshot.source, storagePath: "" },
      },
    }),
    /AUDIO_PROCESSING_INPUT_INVALID/,
  );
});
