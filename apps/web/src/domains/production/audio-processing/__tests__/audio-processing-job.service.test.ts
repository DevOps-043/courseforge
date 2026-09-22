import assert from "node:assert/strict";
import test from "node:test";
import { AudioProcessingJobError, buildAudioProcessingJobInput } from "../audio-processing-job.service";

const validSource = {
  asset_type: "VOICE_AUDIO",
  checksum: "a".repeat(64),
  file_size_bytes: 1024,
  id: "f81d4fae-7dec-4a08-bd4b-5d2b2b6d0c44",
  material_component_id: "4fbcd2af-f3ea-42cd-95fe-f822d201273d",
  mime_type: "audio/wav",
  organization_id: "d4f0864e-508d-4ae3-9072-7ea2a0bf43e8",
  storage_bucket: "production-assets",
  storage_path: "organizations/d4f0864e-508d-4ae3-9072-7ea2a0bf43e8/voice/source.wav",
};

test("creates a canonical worker input from a verified voice asset", () => {
  const input = buildAudioProcessingJobInput(validSource);
  assert.equal(input.profile.id, "voice-course-v1");
  assert.equal(input.source.assetId, validSource.id);
  assert.equal(input.source.checksum, validSource.checksum);
});

test("rejects an asset that is not an eligible voice source", () => {
  assert.throws(
    () => buildAudioProcessingJobInput({ ...validSource, asset_type: "SOURCE_MEDIA" }),
    (error) => error instanceof AudioProcessingJobError && error.code === "AUDIO_SOURCE_INVALID",
  );
});

test("rejects sources exceeding the worker input limit", () => {
  assert.throws(
    () => buildAudioProcessingJobInput({ ...validSource, file_size_bytes: 50 * 1024 * 1024 + 1 }),
    (error) => error instanceof AudioProcessingJobError && error.code === "AUDIO_SOURCE_TOO_LARGE",
  );
});
