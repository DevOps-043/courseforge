import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MaterialAssets, MaterialComponent } from "../../types/materials.types";
import {
  getComponentProductionPercentage,
  getLessonProductionProgress,
} from "../lesson-production-progress";

function componentWithAssets(assets: Partial<MaterialAssets> = {}): MaterialComponent {
  return {
    id: "component-1",
    material_lesson_id: "lesson-1",
    type: "VIDEO_THEORETICAL",
    content: {},
    source_refs: [],
    validation_status: "PASS",
    validation_errors: [],
    generated_at: "2026-08-29T00:00:00.000Z",
    iteration_number: 1,
    assets,
  };
}

describe("lesson production progress", () => {
  it("reports an empty lesson without dividing by zero", () => {
    assert.deepEqual(getLessonProductionProgress([]), {
      completed: 0,
      inProgress: 0,
      percentage: 0,
      total: 0,
    });
  });

  it("distributes the first 50 points across the six video assets", () => {
    const component = componentWithAssets({
      background_music: { storage_path: "music.mp3", public_url: "/music.mp3" },
      avatar_video: { storage_path: "avatar.mp4", public_url: "/avatar.mp4" },
      b_roll_clips: [{ id: "clip-1", storage_path: "clip.mp4", public_url: "/clip.mp4", order: 0 }],
      slides_url: "/slides",
    });

    assert.equal(getComponentProductionPercentage(component), 33);
    assert.deepEqual(getLessonProductionProgress([component]), {
      completed: 0,
      inProgress: 1,
      percentage: 33,
      total: 1,
    });
  });

  it("reports 50 percent when every source asset exists and ignores screencast", () => {
    const component = componentWithAssets({
      voice_audio: { storage_path: "voice.mp3", public_url: "/voice.mp3" },
      background_music: { storage_path: "music.mp3", public_url: "/music.mp3" },
      avatar_video: { storage_path: "avatar.mp4", public_url: "/avatar.mp4" },
      b_roll_clips: [{ id: "clip-1", storage_path: "clip.mp4", public_url: "/clip.mp4", order: 0 }],
      slides_url: "/slides",
      b_roll_prompts: "Prompt listo",
    });

    assert.equal(getComponentProductionPercentage(component), 50);
    component.assets = { ...component.assets, screencast_url: "/screencast.mp4" };
    assert.equal(getComponentProductionPercentage(component), 50);

    assert.equal(
      getComponentProductionPercentage(
        componentWithAssets({ screencast_url: "/screencast-only.mp4" }),
      ),
      0,
    );
  });

  it("only reports 100 percent when the final video exists", () => {
    const component = componentWithAssets({ final_video_url: "/final.mp4" });

    assert.equal(getComponentProductionPercentage(component), 100);
    assert.deepEqual(getLessonProductionProgress([component]), {
      completed: 1,
      inProgress: 0,
      percentage: 100,
      total: 1,
    });
  });

  it("counts manually uploaded voice clips as a valid voice source", () => {
    const component = componentWithAssets({
      manual_voice_clips: [{
        id: "manual-voice-1",
        order: 1,
        storage_path: "production-assets/voices/voice-1.mp3",
        public_url: "/voice-1.mp3",
      }],
    });

    assert.equal(getComponentProductionPercentage(component), 8);
  });

  it("averages component progress for lesson and global summaries", () => {
    const assetsReady = componentWithAssets({
      voice_audio: { storage_path: "voice.mp3", public_url: "/voice.mp3" },
      background_music: { storage_path: "music.mp3", public_url: "/music.mp3" },
      avatar_video: { storage_path: "avatar.mp4", public_url: "/avatar.mp4" },
      b_roll_clips: [{ id: "clip-1", storage_path: "clip.mp4", public_url: "/clip.mp4", order: 0 }],
      slides_url: "/slides",
      b_roll_prompts: "Prompt listo",
    });
    const finalReady = componentWithAssets({ final_video_url: "/final.mp4" });
    finalReady.id = "component-2";

    const progress = getLessonProductionProgress([assetsReady, finalReady]);

    assert.deepEqual(progress, {
      completed: 1,
      inProgress: 1,
      percentage: 75,
      total: 2,
    });
  });
});
