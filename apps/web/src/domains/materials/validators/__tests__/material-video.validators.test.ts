import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoDurationContract } from "../../../video-duration/video-duration-policy";
import {
  collectMaterialVideoValidationErrors,
  validateMaterialVideoComponent,
} from "../material-video.validators";

test("persists failed validation for an invalid generated video", () => {
  const contract = buildVideoDurationContract(null, "VIDEO_DEMO");
  const result = validateMaterialVideoComponent(
    "VIDEO_DEMO",
    {
      duration_estimate_minutes: 7,
      script: {
        sections: [{
          duration_seconds: 360,
          narration_text: "Narración insuficiente",
          timecode_end: "06:00",
          timecode_start: "00:00",
        }],
      },
      storyboard: [{
        narration_text: "Narración insuficiente",
        timecode_end: "06:00",
        timecode_start: "00:00",
      }],
    },
    contract,
  );

  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.some((error) => error.startsWith("INSUFFICIENT_NARRATION:")));
  assert.ok(result.errors.some((error) => error.startsWith("DECLARED_DURATION_MISMATCH:")));
});

test("blocks QA with freshly computed video errors", () => {
  const contract = buildVideoDurationContract(null, "VIDEO_DEMO");
  const errors = collectMaterialVideoValidationErrors([{
    assets: { video_duration_contract: contract },
    content: {
      duration_estimate_minutes: 7,
      script: {
        sections: [{
          duration_seconds: 360,
          narration_text: "Narración insuficiente",
          timecode_end: "06:00",
          timecode_start: "00:00",
        }],
      },
      storyboard: [{
        narration_text: "Narración insuficiente",
        timecode_end: "06:00",
        timecode_start: "00:00",
      }],
    },
    type: "VIDEO_DEMO",
    validation_errors: [],
    validation_status: "PENDING",
  }]);

  assert.ok(errors.some((error) => error.startsWith("VIDEO_DEMO/INSUFFICIENT_NARRATION:")));
});

test("keeps legacy videos without a duration contract backward compatible", () => {
  const errors = collectMaterialVideoValidationErrors([{
    assets: {},
    content: {},
    type: "VIDEO_THEORETICAL",
    validation_errors: [],
    validation_status: "PENDING",
  }]);

  assert.deepEqual(errors, []);
});
