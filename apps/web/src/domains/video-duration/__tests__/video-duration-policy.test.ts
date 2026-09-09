import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoDurationContract,
  DEFAULT_VIDEO_DURATION_POLICY,
  resolveArtifactVideoDurationPolicy,
  resolveVideoDurationPolicy,
  resolveVideoDurationValidationMode,
  type VideoDurationContract,
} from "../video-duration-policy";
import {
  normalizeVideoDurationContent,
  validateVideoDurationContent,
} from "../video-duration-validation";
import {
  applyVideoDurationContractToPlanComponent,
  applyVideoDurationPolicyToPlan,
} from "../video-duration-plan";
import { GLOBAL_VIDEO_DURATION_PROMPTS } from "../../../shared/config/prompts/global-video-duration.prompts";

test("uses the centralized 6-8 minute policy for legacy artifacts", () => {
  assert.deepEqual(resolveArtifactVideoDurationPolicy(null), DEFAULT_VIDEO_DURATION_POLICY);
  assert.equal(buildVideoDurationContract(null).targetWordCount, 1_015);
  assert.equal(buildVideoDurationContract(null).minimumStoryboardTakes, 17);
  assert.equal(buildVideoDurationContract(null).minimumSlideCount, 9);
  assert.equal(buildVideoDurationContract(null).minimumBrollTakes, 6);
});

test("accepts a safe custom duration policy", () => {
  const custom = resolveVideoDurationPolicy({
    maximumDurationSeconds: 600,
    minimumDurationSeconds: 480,
    narrationWordsPerMinute: 140,
    targetDurationSeconds: 540,
    version: 1,
    visualBeatCadenceSeconds: 30,
  });

  assert.equal(custom.targetDurationSeconds, 540);
  assert.equal(buildVideoDurationContract(custom).minimumStoryboardTakes, 18);
});

test("rejects invalid custom values and falls back safely", () => {
  assert.deepEqual(resolveVideoDurationPolicy({
    maximumDurationSeconds: 300,
    minimumDurationSeconds: 600,
    narrationWordsPerMinute: 1,
    targetDurationSeconds: 400,
    version: 1,
    visualBeatCadenceSeconds: 2,
  }), DEFAULT_VIDEO_DURATION_POLICY);
});

test("keeps validation in warning mode until enforcement is explicitly enabled", () => {
  assert.equal(resolveVideoDurationValidationMode(undefined), "warn");
  assert.equal(resolveVideoDurationValidationMode("invalid"), "warn");
  assert.equal(resolveVideoDurationValidationMode(" ENFORCE "), "enforce");
});

test("keeps every global video prompt aligned with the centralized duration contract", () => {
  const expectedCodes = [
    "CLIP_GENERATION_PROMPTS",
    "INSTRUCTIONAL_PLAN",
    "INSTRUCTIONAL_PLAN_SYSTEM",
    "MATERIALS_DEMO_GUIDE",
    "MATERIALS_SYSTEM",
    "MATERIALS_VIDEO_DEMO",
    "MATERIALS_VIDEO_GUIDE",
    "MATERIALS_VIDEO_THEORETICAL",
    "VIDEO_BROLL_PROMPTS",
  ];
  assert.deepEqual(Object.keys(GLOBAL_VIDEO_DURATION_PROMPTS).sort(), expectedCodes);
  assert.match(GLOBAL_VIDEO_DURATION_PROMPTS.INSTRUCTIONAL_PLAN, /\$\{videoDurationPolicy\}/);
  assert.match(GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_SYSTEM, /duration_contract/);
  assert.match(GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_SYSTEM, /900 caracteres por minuto/);
  assert.match(GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_SYSTEM, /palabras son referencias para producción y TTS/);
  assert.match(GLOBAL_VIDEO_DURATION_PROMPTS.MATERIALS_VIDEO_THEORETICAL, /minimumStoryboardTakes/);
});

test("recalculates every video contract when the course standard changes", () => {
  const lessons = [{
    lesson_id: "lesson-1",
    components: [
      { type: "READING", summary: "Lectura" },
      { type: "VIDEO_THEORETICAL", summary: "Explicación. Duración objetivo: 4 min (rango permitido: 3–5 min)." },
    ],
  }];
  const updated = applyVideoDurationPolicyToPlan(lessons, DEFAULT_VIDEO_DURATION_POLICY) as Array<{
    components: Array<{ duration?: string; duration_contract?: VideoDurationContract; summary?: string }>;
  }>;

  assert.equal(updated[0].components[0].duration_contract, undefined);
  assert.equal(updated[0].components[1].duration, "7 min");
  assert.equal(updated[0].components[1].duration_contract?.minimumWordCount, 870);
  assert.match(updated[0].components[1].summary || "", /rango permitido: 6–8 min/);
  assert.doesNotMatch(updated[0].components[1].summary || "", /3–5 min/);
});

test("overrides only the selected lesson video contract", () => {
  const contract = buildVideoDurationContract({
    ...DEFAULT_VIDEO_DURATION_POLICY,
    maximumDurationSeconds: 600,
    minimumDurationSeconds: 480,
    targetDurationSeconds: 540,
  }, "VIDEO_DEMO");
  const lessons = [
    { lesson_id: "lesson-1", components: [{ type: "VIDEO_DEMO", summary: "Demo" }] },
    { lesson_id: "lesson-2", components: [{ type: "VIDEO_DEMO", summary: "Otra demo" }] },
  ];
  const updated = applyVideoDurationContractToPlanComponent(
    lessons,
    "lesson-1",
    "VIDEO_DEMO",
    contract,
  ) as Array<{ components: Array<{ duration?: string }> }>;

  assert.equal(updated[0].components[0].duration, "9 min");
  assert.equal(updated[1].components[0].duration, undefined);
});

test("reports short scripts, sparse storyboards and coverage mismatches", () => {
  const contract = buildVideoDurationContract(null);
  const result = validateVideoDurationContent({
    duration_estimate_minutes: 3,
    script: {
      sections: [{
        duration_seconds: 180,
        narration_text: "Texto demasiado breve.",
        timecode_end: "03:00",
        timecode_start: "00:00",
      }],
    },
    storyboard: [{
      narration_text: "Resumen diferente.",
      timecode_end: "03:00",
      timecode_start: "00:00",
    }],
  }, contract);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "SCRIPT_DURATION_OUT_OF_RANGE"));
  assert.ok(result.issues.some((issue) => issue.code === "INSUFFICIENT_NARRATION"));
  assert.ok(result.issues.some((issue) => issue.code === "STORYBOARD_TOO_SHORT"));
  assert.ok(result.issues.some((issue) => issue.code === "STORYBOARD_COVERAGE_MISMATCH"));
});

test("uses the prompt character budget as the primary narration threshold", () => {
  const contract = buildVideoDurationContract(null);
  const result = validateVideoDurationContent({
    duration_estimate_minutes: 7,
    script: {
      sections: [{
        duration_seconds: 420,
        narration_text: Array.from({ length: contract.minimumWordCount }, () => "a").join(" "),
        timecode_end: "07:00",
        timecode_start: "00:00",
      }],
    },
    storyboard: [{
      narration_text: Array.from({ length: contract.minimumWordCount }, () => "a").join(" "),
      timecode_end: "07:00",
      timecode_start: "00:00",
    }],
  }, contract);

  assert.equal(result.narrationWordCount, contract.minimumWordCount);
  assert.ok(result.narrationCharacterCount < 5_400);
  assert.ok(result.issues.some((issue) => issue.code === "INSUFFICIENT_NARRATION"));
});

test("reports concrete duration and timeline values", () => {
  const contract = buildVideoDurationContract(null);
  const result = validateVideoDurationContent({
    duration_estimate_minutes: 7,
    script: {
      sections: [{
        duration_seconds: 360,
        narration_text: "Narración breve",
        timecode_end: "06:00",
        timecode_start: "00:05",
      }],
    },
    storyboard: [{
      narration_text: "Narración breve",
      timecode_end: "05:50",
      timecode_start: "00:00",
    }],
  }, contract);

  const declaredMismatch = result.issues.find(
    (issue) => issue.code === "DECLARED_DURATION_MISMATCH",
  );
  const scriptTimeline = result.issues.find(
    (issue) => issue.code === "INVALID_SCRIPT_TIMECODES",
  );
  const storyboardTimeline = result.issues.find(
    (issue) => issue.code === "INVALID_STORYBOARD_TIMECODES",
  );
  assert.match(declaredMismatch?.message || "", /declara 420s.*suman 360s/);
  assert.ok(result.issues.some((issue) => issue.code === "SCRIPT_TARGET_DURATION_MISMATCH"));
  assert.match(scriptTimeline?.message || "", /comienza en 5s.*debía comenzar en 0s/);
  assert.match(storyboardTimeline?.message || "", /finaliza en 350s.*debía finalizar en 360s/);
});

test("normalizes model-derived script arithmetic deterministically", () => {
  const normalized = normalizeVideoDurationContent({
    duration_estimate_minutes: 7,
    script: {
      sections: [
        {
          duration_seconds: 100.4,
          timecode_end: "01:50",
          timecode_start: "00:10",
        },
        {
          duration_seconds: 319.6,
          timecode_end: "07:20",
          timecode_start: "01:55",
        },
      ],
    },
  }) as {
    duration_estimate_minutes: number;
    script: { sections: Array<Record<string, unknown>> };
  };

  assert.equal(normalized.duration_estimate_minutes, 7);
  assert.deepEqual(normalized.script.sections.map((section) => ({
    duration: section.duration_seconds,
    end: section.timecode_end,
    start: section.timecode_start,
  })), [
    { duration: 100, end: "01:40", start: "00:00" },
    { duration: 320, end: "07:00", start: "01:40" },
  ]);
});

test("derives script and storyboard timing from editorial characters", () => {
  const contract = buildVideoDurationContract(null, "VIDEO_DEMO");
  const narration = Array.from({ length: 630 }, () => "contenido").join(" ");
  const firstHalf = narration.split(" ").slice(0, 315).join(" ");
  const secondHalf = narration.split(" ").slice(315).join(" ");
  const normalized = normalizeVideoDurationContent({
    duration_estimate_minutes: 9.3,
    script: {
      sections: [
        {
          duration_seconds: 279,
          narration_text: firstHalf,
          timecode_end: "04:39",
          timecode_start: "00:00",
        },
        {
          duration_seconds: 279,
          narration_text: secondHalf,
          timecode_end: "09:18",
          timecode_start: "04:39",
        },
      ],
    },
    storyboard: [
      {
        narration_text: "resumen que no coincide",
        timecode_end: "03:30",
        timecode_start: "00:00",
      },
      {
        narration_text: "otro resumen",
        timecode_end: "07:00",
        timecode_start: "03:30",
      },
    ],
  }, contract) as {
    duration_estimate_minutes: number;
    script: { sections: Array<Record<string, unknown>> };
    storyboard: Array<Record<string, unknown>>;
  };

  const expectedSeconds = Math.round((narration.length / 900) * 60);
  assert.equal(
    normalized.script.sections.reduce(
      (total, section) => total + Number(section.duration_seconds),
      0,
    ),
    expectedSeconds,
  );
  assert.equal(
    normalized.storyboard.at(-1)?.timecode_end,
    formatTimecode(expectedSeconds),
  );
  assert.equal(
    normalized.storyboard.map((take) => take.narration_text).join(" "),
    narration,
  );
  assert.equal(normalized.duration_estimate_minutes, Number((expectedSeconds / 60).toFixed(4)));
});

test("does not preserve an invented 558-second timeline for short narration", () => {
  const contract = buildVideoDurationContract(null, "VIDEO_DEMO");
  const narration = "a".repeat(5_056);
  const normalized = normalizeVideoDurationContent({
    duration_estimate_minutes: 7,
    script: {
      sections: [{
        duration_seconds: 558,
        narration_text: narration,
        timecode_end: "09:18",
        timecode_start: "00:00",
      }],
    },
    storyboard: [{
      narration_text: "resumen distinto",
      timecode_end: "07:00",
      timecode_start: "00:00",
      visual_type: "b_roll",
    }],
  }, contract) as Record<string, unknown>;
  const result = validateVideoDurationContent(normalized, contract);

  assert.equal(result.scriptDurationSeconds, 337);
  assert.equal(result.estimatedNarrationDurationSeconds, 337);
  assert.ok(result.issues.some((issue) => issue.code === "INSUFFICIENT_NARRATION"));
  assert.ok(result.issues.some((issue) => issue.code === "NARRATION_TARGET_MISMATCH"));
  assert.ok(!result.issues.some((issue) => issue.code === "INVALID_STORYBOARD_TIMECODES"));
  assert.ok(!result.issues.some((issue) => issue.code === "STORYBOARD_COVERAGE_MISMATCH"));
});

test("accepts a continuous 7-minute script with sufficient visual coverage", () => {
  const contract = buildVideoDurationContract(null);
  const sectionCount = contract.minimumStoryboardTakes;
  const targetCharactersPerSection = Math.ceil(6_300 / sectionCount);
  let cursor = 0;
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const duration = index === sectionCount - 1
      ? contract.targetDurationSeconds - cursor
      : Math.floor(contract.targetDurationSeconds / sectionCount);
    const narration = "a".repeat(targetCharactersPerSection);
    const section = {
      duration_seconds: duration,
      narration_text: narration,
      on_screen_text: `Concepto ${index + 1}`,
      timecode_end: formatTimecode(cursor + duration),
      timecode_start: formatTimecode(cursor),
    };
    cursor += duration;
    return section;
  });
  const storyboard = sections.map((section, index) => ({
    narration_text: section.narration_text,
    timecode_end: section.timecode_end,
    timecode_start: section.timecode_start,
    visual_type: index < contract.minimumBrollTakes ? "B_ROLL" : "SLIDE",
  }));

  const result = validateVideoDurationContent({
    duration_estimate_minutes: 7,
    script: { sections },
    storyboard,
  }, contract);

  assert.equal(result.valid, true, JSON.stringify(result.issues));
});

function formatTimecode(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
