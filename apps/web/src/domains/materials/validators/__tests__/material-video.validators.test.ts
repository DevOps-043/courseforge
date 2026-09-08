import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoDurationContract } from "../../../video-duration/video-duration-policy";
import {
  buildVideoGenerationGuardrails,
  buildVideoRepairInstructions,
  collectMaterialVideoValidationErrors,
  shouldUseVideoRepairCandidate,
  validateMaterialVideoComponent,
} from "../material-video.validators";

test("appends non-overridable video guardrails for organizations with custom prompts", () => {
  const contract = buildVideoDurationContract(null, "VIDEO_DEMO");
  const guardrails = buildVideoGenerationGuardrails([{
    duration_contract: contract,
    type: "VIDEO_DEMO",
  }]);

  assert.match(guardrails, /no son personalizables/);
  assert.match(guardrails, /objetivo 420s/);
  assert.match(guardrails, /objetivo 6300/);
  assert.match(guardrails, /3 B-roll/);
});

test("builds a targeted repair prompt from the exact production contract", () => {
  const contract = buildVideoDurationContract(null, "VIDEO_DEMO");
  const instructions = buildVideoRepairInstructions(
    "VIDEO_DEMO",
    contract,
    ["INSUFFICIENT_BROLL_COVERAGE: requiere más B-roll"],
  );

  assert.match(instructions, /Corrige únicamente VIDEO_DEMO/);
  assert.match(instructions, /420s/);
  assert.match(instructions, /6300 caracteres editoriales/);
  assert.match(instructions, /3 tomas B-roll/);
  assert.match(instructions, /INSUFFICIENT_BROLL_COVERAGE/);
});

test("accepts a video repair that fully passes validation", () => {
  assert.equal(
    shouldUseVideoRepairCandidate(
      {
        valid: false,
        issues: [{
          code: "INSUFFICIENT_NARRATION",
          message: "Narration is too short",
        }],
      },
      { valid: true, issues: [] },
    ),
    true,
  );
});

test("accepts partial repair progress only when it adds no new errors", () => {
  const initialValidation = {
    valid: false,
    issues: [
      {
        code: "INSUFFICIENT_NARRATION" as const,
        message: "Narration is too short",
      },
      {
        code: "INSUFFICIENT_BROLL_COVERAGE" as const,
        message: "Not enough B-roll shots",
      },
    ],
  };

  assert.equal(
    shouldUseVideoRepairCandidate(initialValidation, {
      valid: false,
      issues: [{
        code: "INSUFFICIENT_NARRATION",
        message: "Narration is still too short",
      }],
    }),
    true,
  );
  assert.equal(
    shouldUseVideoRepairCandidate(initialValidation, {
      valid: false,
      issues: [
        {
          code: "INSUFFICIENT_NARRATION",
          message: "Narration is still too short",
        },
        {
          code: "INVALID_STORYBOARD_TIMECODES",
          message: "Storyboard coverage is invalid",
        },
      ],
    }),
    false,
  );
});

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
