import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoDurationContract, DEFAULT_VIDEO_DURATION_POLICY, buildVideoNarrationCharacterBudget } from "../../../video-duration/video-duration-policy";
import { validateVideoDurationContent } from "../../../video-duration/video-duration-validation";
import type { MaterialsGenerationInput, ReadingContent, VideoGuideContent } from "../../types/materials.types";
import { generateVideoInStages } from "../video-generation.service";
import { VIDEO_GENERATION_LIMITS, VideoModelResponseError, type VideoModelRequest, type VideoScriptDraft, type VideoStoryboardDraft } from "../video-generation.contracts";
import { buildStoryboardNarration, assembleStoryboard, type StoryboardNarrationTake } from "../video-storyboard-timeline";
import { generateMaterialsByComponent } from "../materials-generation.service";
import { buildMaterialComponentWrites } from "../material-component-write";
import { buildNarrationRevisionBudget, buildDemoNarrationBudget, buildStagedVideoPrompt } from "../video-generation.prompts";
import { applyVideoNarrationRevision } from "../video-generation.contracts";

test("revision budgets use measured narration and account for section separators", () => {
  const budget = buildNarrationRevisionBudget(scriptDraft(8_650), 6_300).join("\n");
  assert.match(budget, /73%/);
  const targets = [...budget.matchAll(/objetivo (\d+) caracteres/g)].map((match) => Number(match[1]));
  assert.equal(targets.length, 8);
  assert.equal(targets.reduce((sum, count) => sum + count, 0) + targets.length - 1, 6_300);
  assert.deepEqual(buildNarrationRevisionBudget({}, 6_300), []);
});

test("demo opening, development and closing share one total narration budget", () => {
  const targets = [...buildDemoNarrationBudget(6300).join("\n").matchAll(/: (\d+) caracteres/g)].map((match) => Number(match[1]));
  assert.equal(targets.reduce((sum, count) => sum + count, 0) + targets.length - 1, 6300);
  assert.equal(targets.length, 7);
});

const contract = buildVideoDurationContract({ ...DEFAULT_VIDEO_DURATION_POLICY, minimumDurationSeconds: 600, targetDurationSeconds: 660, maximumDurationSeconds: 720 }, "VIDEO_DEMO");
const input: MaterialsGenerationInput = {
  lesson: {
    lesson_id: "lesson-1", lesson_title: "Agentes", module_id: "module-1", module_title: "Fundamentos", oa_text: "Comparar flujos",
    components: [{ type: "VIDEO_DEMO", summary: "Comparar agentes y modelos", duration_contract: contract }],
    quiz_spec: { min_questions: 3, max_questions: 5, types: ["MULTIPLE_CHOICE"] }, requires_demo_guide: false,
  },
  sources: [{ id: "source-1", source_title: "Fuente", source_ref: "https://example.test/docs", cobertura_completa: true }], iteration_number: 1,
};
const prompts = { systemPrompt: "900 caracteres por minuto", componentPrompts: { VIDEO_DEMO: "Demostración" }, promptSources: {}, promptVersions: {} };

function scriptDraft(characterCount: number): VideoScriptDraft {
  const narration = Array.from({ length: Math.ceil(characterCount / 10) }, () => "contenido").join(" ").slice(0, characterCount).trim();
  const words = narration.split(" ");
  const sectionCount = 8;
  return {
    title: "Agentes", source_refs_used: ["source-1"], script: {
      sections: Array.from({ length: sectionCount }, (_, index) => ({
        section_type: "demonstration", visual_notes: `Estado ${index + 1}`, on_screen_text: `Paso ${index + 1}`,
        narration_text: words.slice(Math.floor(index * words.length / sectionCount), Math.floor((index + 1) * words.length / sectionCount)).join(" "),
      })),
    },
  };
}

function takesFromPrompt(prompt: string): StoryboardNarrationTake[] {
  const section = prompt.split("## TOMAS CON NARRACIÓN APROBADA\n\n")[1];
  assert.ok(section, "storyboard request includes the fixed narration");
  return JSON.parse(section.split("\n\n")[0]);
}

function storyboardDraft(takes: StoryboardNarrationTake[], brollCount = contract.minimumBrollTakes): VideoStoryboardDraft {
  return { storyboard: takes.map((take, index) => ({
    take_number: take.take_number, visual_type: index < brollCount ? "b_roll" : "screen_recording",
    visual_content: `Evidencia de ${take.section_number}`, on_screen_text: `Paso ${take.take_number}`, on_screen_action: "Ejecutar el paso",
  })) };
}

async function generateValidVideo(): Promise<VideoGuideContent> {
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary", "fallback"],
    request: async ({ prompt }) => ({ content: prompt.includes("ETAPA ACTUAL: GUION") ? scriptDraft(9_900) : storyboardDraft(takesFromPrompt(prompt)) }),
  });
  assert.ok(result.success, !result.success ? result.error : "");
  return result.content;
}

test("recovers the 3,809-character regression before generating the storyboard", async () => {
  const requests: Parameters<VideoModelRequest>[0][] = [];
  let scriptRequests = 0;
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary", "fallback"],
    request: async (request) => {
      requests.push(request);
      if (request.prompt.includes("ETAPA ACTUAL: GUION")) {
        scriptRequests++;
        if (scriptRequests > 1) {
          assert.match(request.prompt, /BORRADOR ANTERIOR PARA CORRECCIÓN/);
          assert.match(request.prompt, /INSUFFICIENT_NARRATION/);
        }
        return { content: scriptDraft([3_809, 7_500, 9_900][scriptRequests - 1]), finishReason: "STOP", outputTokens: 3_000 };
      }
      assert.equal(scriptRequests, 3);
      return { content: storyboardDraft(takesFromPrompt(request.prompt)) };
    },
  });
  assert.ok(result.success, !result.success ? result.error : "");
  assert.deepEqual(requests.slice(0, 3).map((request) => request.model), ["primary", "primary", "fallback"]);
  assert.equal(result.attempts.length, 4);
  assert.deepEqual(result.attempts.map((attempt) => attempt.outcome), ["invalid", "invalid", "valid", "valid"]);
  assert.equal(validateVideoDurationContent(result.content, contract).valid, true);
  assert.equal(result.content.storyboard.map((take) => take.narration_text).join(" "), result.content.script.sections.map((section) => section.narration_text).join(" "));
});

test("exhausted narration retries fail without creating or accepting a storyboard", async () => {
  let calls = 0;
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"],
    request: async ({ prompt }) => { calls++; assert.match(prompt, /ETAPA ACTUAL: GUION/); return { content: scriptDraft(3_809) }; },
  });
  assert.equal(result.success, false);
  assert.equal(calls, VIDEO_GENERATION_LIMITS.attemptsPerStage);
  assert.equal("content" in result, false);
  assert.ok(result.attempts.every((attempt) => attempt.issueCodes.includes("INSUFFICIENT_NARRATION")));
});

test("oversized demo is corrected through narration-only revisions before storyboard generation", async () => {
  let scripts = 0;
  const oversized = scriptDraft(15_000);
  const corrected = scriptDraft(9_900);
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"],
    request: async ({ prompt }) => {
      if (prompt.includes("ETAPA ACTUAL: GUION")) {
        if (++scripts === 1) return { content: oversized };
        assert.match(prompt, /EXCESSIVE_NARRATION/);
        assert.match(prompt, /narration_sections/);
        return { content: { narration_sections: corrected.script.sections.map((section, index) => ({
          section_number: index + 1, narration_text: section.narration_text,
        })) } };
      }
      return { content: storyboardDraft(takesFromPrompt(prompt)) };
    },
  });
  assert.ok(result.success);
  assert.deepEqual(result.sourceRefs, oversized.source_refs_used);
  assert.equal(result.content.script.sections[0].visual_notes, oversized.script.sections[0].visual_notes);
  assert.equal(validateVideoDurationContent(result.content, contract).valid, true);
  const duplicate = { narration_sections: corrected.script.sections.map((section) => ({ section_number: 1, narration_text: section.narration_text })) };
  assert.throws(() => applyVideoNarrationRevision(duplicate, oversized), /SCRIPT_SECTION_MAPPING/);
});

test("script visual errors allow restructuring instead of restricting correction to narration", () => {
  const prompt = buildStagedVideoPrompt({ input, contract, componentType: "VIDEO_DEMO", prompts, stage: "script",
    previousDraft: scriptDraft(9_900), feedback: ["INSUFFICIENT_SLIDE_COVERAGE: Faltan beats visuales."] });
  assert.doesNotMatch(prompt, /devuelve únicamente narration_sections/);
  assert.match(prompt, /on_screen_text/);
});

test("corrects visual coverage without regenerating a valid script", async () => {
  let scripts = 0;
  let storyboards = 0;
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"],
    request: async ({ prompt }) => {
      if (prompt.includes("ETAPA ACTUAL: GUION")) { scripts++; return { content: scriptDraft(9_900) }; }
      storyboards++;
      if (storyboards > 1) assert.match(prompt, /INSUFFICIENT_BROLL_COVERAGE/);
      return { content: storyboardDraft(takesFromPrompt(prompt), storyboards === 1 ? 0 : 4) };
    },
  });
  assert.ok(result.success);
  assert.equal(scripts, 1);
  assert.equal(storyboards, 2);
});

test("retains the best script when a later attempt regresses", async () => {
  let calls = 0;
  await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"],
    request: async ({ prompt }) => {
      calls++;
      if (calls === 3) {
        const previous = JSON.parse(prompt.split("## BORRADOR ANTERIOR PARA CORRECCIÓN\n\n")[1].split("\n\n")[0]);
        assert.deepEqual(previous, scriptDraft(7_500));
      }
      return { content: scriptDraft(calls === 1 ? 7_500 : 3_809) };
    },
  });
});

test("rejects malformed output and references outside the lesson", async () => {
  for (const content of [{}, { ...scriptDraft(9_900), source_refs_used: ["unknown-source"] }]) {
    const result = await generateVideoInStages({ input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"], request: async () => ({ content }) });
    assert.equal(result.success, false);
    assert.ok(result.attempts.every((attempt) => attempt.issueCodes.includes("INVALID_STAGE_SCHEMA") || attempt.issueCodes.includes("UNKNOWN_SOURCE_REFS")));
  }
});

test("never exceeds its time budget or emits unbounded provider errors in diagnostics", async () => {
  let clockMs = 0;
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"], now: () => clockMs,
    request: async ({ timeoutMs }) => {
      assert.ok(timeoutMs <= VIDEO_GENERATION_LIMITS.requestTimeoutMs);
      clockMs += VIDEO_GENERATION_LIMITS.totalTimeoutMs;
      throw new Error("private-provider-detail");
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.attempts.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-detail/);
});

test("fixed storyboard mapping rejects duplicates and missing or foreign take numbers", async () => {
  const video = await generateValidVideo();
  const narration = buildStoryboardNarration(video, contract);
  const valid = storyboardDraft(narration);
  assert.equal(assembleStoryboard(narration, valid).length, narration.length);
  const duplicate = structuredClone(valid);
  duplicate.storyboard[1].take_number = duplicate.storyboard[0].take_number;
  assert.throws(() => assembleStoryboard(narration, duplicate), /STORYBOARD_TAKE_MAPPING/);
  assert.throws(() => assembleStoryboard(narration, { storyboard: valid.storyboard.slice(1) }), /STORYBOARD_TAKE_MAPPING/);
  const foreign = structuredClone(valid);
  foreign.storyboard[0].take_number = 999;
  assert.throws(() => assembleStoryboard(narration, foreign), /STORYBOARD_TAKE_MAPPING/);
});

test("permanent provider errors skip the unavailable primary for subsequent stages", async () => {
  const models: string[] = [];
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary", "fallback"],
    request: async ({ model, prompt }) => {
      models.push(model);
      if (model === "primary") throw Object.assign(new Error("private-provider-details"), { status: 403 });
      return { content: prompt.includes("ETAPA ACTUAL: GUION") ? scriptDraft(9_900) : storyboardDraft(takesFromPrompt(prompt)) };
    },
  });
  assert.ok(result.success);
  assert.deepEqual(models, ["primary", "fallback", "fallback"]);
  assert.deepEqual(result.attempts[0].issueCodes, ["MODEL_HTTP_403"]);
});

test("an unavailable primary does not consume the fallback narration correction attempt", async () => {
  let fallbackScripts = 0;
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary", "fallback"],
    request: async ({ model, prompt }) => {
      if (model === "primary") throw Object.assign(new Error("unavailable"), { status: 403 });
      if (prompt.includes("ETAPA ACTUAL: GUION")) return { content: scriptDraft(++fallbackScripts === 1 ? 15_000 : 9_900) };
      return { content: storyboardDraft(takesFromPrompt(prompt)) };
    },
  });
  assert.ok(result.success);
  assert.equal(fallbackScripts, 2);
  assert.deepEqual(result.attempts.map((attempt) => attempt.model), ["primary", "fallback", "fallback", "fallback"]);
});

test("retry backoff and provider timeouts share the remaining lesson budget", async () => {
  let clockMs = 0;
  const waits: number[] = [];
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"], now: () => clockMs, deadlineMs: 200,
    wait: async (milliseconds) => { waits.push(milliseconds); clockMs += milliseconds; },
    request: async ({ timeoutMs }) => {
      assert.equal(timeoutMs, 200);
      clockMs += 100;
      throw Object.assign(new Error("Rate limit"), { status: 429 });
    },
  });
  assert.equal(result.success, false);
  assert.deepEqual(waits, [100]);
  assert.equal(result.attempts.length, 1);
  assert.equal(clockMs, 200);
});

test("truncated responses retain termination and usage without exposing the payload", async () => {
  const result = await generateVideoInStages({
    input, contract, componentType: "VIDEO_DEMO", prompts, models: ["primary"],
    request: async () => { throw new VideoModelResponseError("MODEL_JSON_TRUNCATED", "MAX_TOKENS", 16_000); },
  });
  assert.equal(result.success, false);
  assert.ok(result.attempts.every((attempt) => attempt.finishReason === "MAX_TOKENS" && attempt.outputTokens === 16_000));
});

test("all supported video types keep their existing content contract", async () => {
  for (const componentType of ["VIDEO_THEORETICAL", "VIDEO_GUIDE"] as const) {
    const result = await generateVideoInStages({
      input, contract, componentType, prompts, models: ["primary"],
      request: async ({ prompt }) => {
        if (prompt.includes("ETAPA ACTUAL: GUION")) return { content: {
          ...scriptDraft(9_900),
          parallel_exercise: { title: "Práctica", instructions: "Verifica el flujo", steps: [{ step_number: 1, instruction: "Comparar resultados" }] },
        } };
        const draft = storyboardDraft(takesFromPrompt(prompt));
        draft.storyboard.forEach((take) => { if (take.visual_type !== "b_roll") take.visual_type = componentType === "VIDEO_GUIDE" ? "step_capture" : "slide"; });
        return { content: draft };
      },
    });
    assert.ok(result.success, !result.success ? result.error : "");
    assert.equal(result.content.parallel_exercise?.steps.length, 1);
    assert.equal(validateVideoDurationContent(result.content, contract).valid, true);
  }
});

test("takes preserve section boundaries, positive durations and literal narration", async () => {
  const video = await generateValidVideo();
  const takes = buildStoryboardNarration(video, contract);
  for (const section of video.script.sections) {
    const sectionTakes = takes.filter((take) => take.section_number === section.section_number);
    assert.ok(sectionTakes.length >= 2);
    assert.equal(sectionTakes[0].timecode_start, section.timecode_start);
    assert.equal(sectionTakes.at(-1)?.timecode_end, section.timecode_end);
    assert.equal(sectionTakes.map((take) => take.narration_text).join(" "), section.narration_text);
  }
});

test("short sections do not force two takes and inflate a five-minute video to 30 takes", () => {
  const video = { script: { sections: Array.from({ length: 15 }, (_, index) => ({
    section_number: index + 1, narration_text: "Un paso concreto con evidencia observable del resultado esperado.",
    duration_seconds: 20, visual_notes: "Resultado",
  })) } } as VideoGuideContent;
  const policy = buildVideoDurationContract({ ...DEFAULT_VIDEO_DURATION_POLICY, minimumDurationSeconds: 180, targetDurationSeconds: 300, maximumDurationSeconds: 420 }, "VIDEO_DEMO");
  const takes = buildStoryboardNarration(video, policy);
  assert.equal(takes.length, 15);
  assert.equal(takes.at(-1)?.timecode_end, "05:00");
  assert.equal(takes.map((take) => take.narration_text).join(" "), video.script.sections.map((section) => section.narration_text).join(" "));
});

test("equal duration endpoints still receive the editorial margin", () => {
  const exact = buildVideoNarrationCharacterBudget({ minimumDurationSeconds: 600, targetDurationSeconds: 600, maximumDurationSeconds: 600 });
  assert.equal(exact.targetMinimum, 8_550);
  assert.equal(exact.targetMaximum, 9_450);
});

test("a failed video keeps the other generated materials and returns a failed lesson result", async () => {
  const reading: ReadingContent = { title: "Lectura", body_html: "Texto", sections: [], estimated_reading_time_min: 1, key_points: [], reflection_question: "Pregunta" };
  const result = await generateMaterialsByComponent({
    input: { ...input, lesson: { ...input.lesson, components: [...input.lesson.components, { type: "READING", summary: "Refuerzo" }] } },
    generateStandard: async (standardInput) => {
      assert.deepEqual(standardInput.lesson.components.map((component) => component.type), ["READING"]);
      return { success: true, content: { components: { READING: reading }, source_refs_used: ["source-1"] } };
    },
    generateVideo: async () => ({ success: false, error: "VIDEO_DEMO/GENERATION_FAILED", attempts: [] }),
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.content?.components, { READING: reading });
});

test("video-only regeneration does not call the standard generator", async () => {
  const video = await generateValidVideo();
  const result = await generateMaterialsByComponent({
    input,
    generateStandard: async () => { throw new Error("Unrequested standard generation"); },
    generateVideo: async (type) => { assert.equal(type, "VIDEO_DEMO"); return { success: true, content: video, sourceRefs: ["source-1"], attempts: [] }; },
  });
  assert.ok(result.success);
  assert.deepEqual(Object.keys(result.content.components), ["VIDEO_DEMO"]);
});

test("a thrown provider error preserves already generated materials", async () => {
  const reading: ReadingContent = { title: "Lectura", body_html: "Texto", sections: [], estimated_reading_time_min: 1, key_points: [], reflection_question: "Pregunta" };
  const result = await generateMaterialsByComponent({
    input: { ...input, lesson: { ...input.lesson, components: [...input.lesson.components, { type: "READING", summary: "Refuerzo" }] } },
    generateStandard: async () => ({ success: true, content: { components: { READING: reading }, source_refs_used: ["source-1"] } }),
    generateVideo: async () => { throw new Error("provider unavailable"); },
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.content?.components, { READING: reading });
});

test("write preflight rejects invalid videos and writes only the successful selected component", async () => {
  const video = await generateValidVideo();
  const params = {
    lessonId: "lesson-1", content: { components: { VIDEO_DEMO: video }, source_refs_used: ["source-1"] },
    iteration: 2, generatedAt: "2026-09-15T00:00:00Z", onlyTypes: ["VIDEO_DEMO"], durationContractsByType: { VIDEO_DEMO: contract },
  };
  const rows = buildMaterialComponentWrites(params);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].validation_status, "PASS");
  assert.equal("id" in rows[0], false, "upsert preserves an existing component ID");
  assert.throws(() => buildMaterialComponentWrites({ ...params, onlyTypes: ["READING"] }), /MATERIALS_COMPONENT_MISMATCH/);
  assert.throws(() => buildMaterialComponentWrites({ ...params, durationContractsByType: {} }), /VIDEO_VALIDATION_FAILED/);
  const invalid = structuredClone(params);
  invalid.content.components.VIDEO_DEMO.script.sections[0].narration_text = "Breve";
  assert.throws(() => buildMaterialComponentWrites(invalid), /VIDEO_VALIDATION_FAILED/);
});
