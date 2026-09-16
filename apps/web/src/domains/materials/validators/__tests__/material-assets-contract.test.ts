import assert from "node:assert/strict";
import test from "node:test";
import { materialAssetsSchema } from "../assets.validators";

test("material assets accept explicit nullable removals", () => {
  const parsed = materialAssetsSchema.parse({
    avatar_video: null,
    background_music: null,
    slides: null,
    voice_audio: null,
  });

  assert.equal(parsed.avatar_video, null);
  assert.equal(parsed.background_music, null);
  assert.equal(parsed.slides, null);
  assert.equal(parsed.voice_audio, null);
});

test("material assets preserve current production contracts", () => {
  const parsed = materialAssetsSchema.parse({
    assembly_target_duration_seconds: 420,
    dod_checklist: {
      has_b_roll_prompts: true,
      has_final_video_url: false,
      has_screencast_url: false,
      has_slides_url: true,
      has_video_url: true,
    },
    final_video_asset_provider: "hyperframes",
    final_video_source: "hyperframes_cloud",
    slides: {
      prepared_at: "2026-09-09T00:00:00.000Z",
      prepared_from_storyboard: true,
      prepared_slide_count: 8,
    },
  });

  assert.equal(parsed.final_video_source, "hyperframes_cloud");
  assert.equal(parsed.final_video_asset_provider, "hyperframes");
  assert.equal(parsed.assembly_target_duration_seconds, 420);
  assert.equal(parsed.slides?.prepared_slide_count, 8);
  assert.equal(parsed.dod_checklist?.has_slides_url, true);
});

test("material assets reject impossible persisted statuses", () => {
  const parsed = materialAssetsSchema.safeParse({ production_status: "READY" });
  assert.equal(parsed.success, false);
});
