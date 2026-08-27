import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveProductionAssetRequirements,
  evaluateProductionItemReadiness,
} from "../production-automation-readiness.service";

describe("production automation readiness", () => {
  it("requires only the storyboard assets explicitly requested", () => {
    const requirements = deriveProductionAssetRequirements([
      {
        narration_text: "Explicamos el concepto.",
        take_number: 1,
        timecode_end: "00:00:10",
        timecode_start: "00:00:00",
        visual_content: "Una persona trabaja junto a diapositivas.",
        visual_type: "Presentacion",
      },
    ]);

    assert.deepEqual(requirements.map((requirement) => requirement.kind), [
      "AVATAR_AND_VOICE",
      "SLIDES",
    ]);
  });

  it("requires every scene avatar to have its synchronized voice", () => {
    const requirements = [{ kind: "AVATAR_AND_VOICE", reason: "Narracion" }] as const;
    const assets = {
      avatar_generation_mode: "scene_clips" as const,
      avatar_clips: [{
        id: "scene-1",
        order: 1,
        public_url: "https://example.test/avatar.mp4",
        script_hash: "same-script",
        script_text: "Hola",
        status: "COMPLETED" as const,
      }],
      voice_clips: [{
        clip_id: "scene-1",
        id: "voice-1",
        order: 1,
        public_url: "https://example.test/voice.mp3",
        script_hash: "different-script",
        status: "COMPLETED" as const,
        storage_path: "voices/voice.mp3",
      }],
    };

    assert.equal(evaluateProductionItemReadiness({ assets, requirements: [...requirements] }).complete, false);
    assets.voice_clips[0]!.script_hash = "same-script";
    assert.equal(evaluateProductionItemReadiness({ assets, requirements: [...requirements] }).complete, true);
  });

  it("does not treat a slide reference as a ready editable asset", () => {
    const result = evaluateProductionItemReadiness({
      assets: { slides_url: "https://example.test/deck" },
      requirements: [{ kind: "SLIDES", reason: "Storyboard" }],
    });

    assert.equal(result.complete, false);
    assert.match(result.requirements[0]!.detail || "", /renderizables/);
  });
});
