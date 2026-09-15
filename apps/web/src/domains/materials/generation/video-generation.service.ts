import { z } from "zod";
import type { ResolvedPrompts } from "../../../shared/config/prompts/prompt-resolver.service";
import { buildVideoNarrationCharacterBudget, videoDurationContractSchema, type VideoComponentType, type VideoDurationContract } from "../../video-duration/video-duration-policy";
import { normalizeVideoDurationContent, validateVideoDurationContent } from "../../video-duration/video-duration-validation";
import type { MaterialsGenerationInput, VideoGuideContent } from "../types/materials.types";
import {
  VIDEO_GENERATION_LIMITS,
  VideoModelResponseError,
  videoScriptDraftSchema,
  videoStoryboardDraftSchema,
  type VideoGenerationAttempt,
  type VideoGenerationStage,
  type VideoModelRequest,
  type VideoScriptDraft,
} from "./video-generation.contracts";
import { buildStagedVideoPrompt } from "./video-generation.prompts";
import { assembleStoryboard, buildStoryboardNarration } from "./video-storyboard-timeline";

interface ValidatedCandidate<T> {
  value: T;
  draft: unknown;
  issues: Array<{ code: string; message: string }>;
  score: number;
  narrationCharacterCount: number;
  durationSeconds: number;
}

export type VideoGenerationResult = {
  success: true;
  content: VideoGuideContent;
  sourceRefs: string[];
  attempts: VideoGenerationAttempt[];
} | {
  success: false;
  error: string;
  attempts: VideoGenerationAttempt[];
};

export async function generateVideoInStages(params: {
  input: MaterialsGenerationInput;
  componentType: VideoComponentType;
  contract: VideoDurationContract;
  prompts: ResolvedPrompts;
  models: string[];
  request: VideoModelRequest;
  now?: () => number;
  deadlineMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<VideoGenerationResult> {
  const { input, componentType, prompts, request } = params;
  const contract = videoDurationContractSchema.parse(params.contract);
  const models = [...new Set(params.models.filter(Boolean))];
  const now = params.now ?? Date.now;
  const deadline = Math.min(params.deadlineMs ?? Infinity, now() + VIDEO_GENERATION_LIMITS.totalTimeoutMs);
  const wait = params.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const attempts: VideoGenerationAttempt[] = [];
  const budget = buildVideoNarrationCharacterBudget(contract);
  const allowedSources = new Set(input.sources.map((source) => source.id));
  const unavailableModels = new Set<string>();
  if (!models.length) return { success: false, error: "MODEL_SETTING_NOT_CONFIGURED: Materiales no tiene modelos configurados.", attempts };

  async function runStage<T>(
    stage: VideoGenerationStage,
    evaluate: (content: unknown) => ValidatedCandidate<T>,
    narration?: ReturnType<typeof buildStoryboardNarration>,
  ): Promise<T | null> {
    let best: ValidatedCandidate<T> | undefined;
    let feedback: string[] = [];
    for (let index = 0; models.length && index < VIDEO_GENERATION_LIMITS.attemptsPerStage; index++) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) break;
      // One correction with the primary; the last attempt uses the configured fallback.
      const model = models[index < 2 ? 0 : Math.min(1, models.length - 1)];
      if (unavailableModels.has(model)) continue;
      const startedAt = now();
      const attempt: VideoGenerationAttempt = {
        stage, model, attempt: index + 1, outcome: "request_failed", issueCodes: [], elapsedMs: 0,
      };
      try {
        const response = await request({
          model,
          timeoutMs: Math.min(VIDEO_GENERATION_LIMITS.requestTimeoutMs, remainingMs),
          prompt: buildStagedVideoPrompt({
            input, componentType, contract, prompts, stage, narration,
            previousDraft: best?.draft, feedback,
          }),
        });
        attempt.finishReason = response.finishReason;
        attempt.outputTokens = response.outputTokens;
        const candidate = evaluate(response.content);
        attempt.outcome = candidate.issues.length ? "invalid" : "valid";
        attempt.issueCodes = candidate.issues.map((issue) => issue.code);
        attempt.narrationCharacterCount = candidate.narrationCharacterCount;
        attempt.durationSeconds = candidate.durationSeconds;
        if (!best || candidate.score < best.score) best = candidate;
        feedback = best.issues.map((issue) => `${issue.code}: ${issue.message}`);
        if (!candidate.issues.length) return candidate.value;
      } catch (error) {
        const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
        if ([400, 401, 403, 404].includes(status)) unavailableModels.add(model);
        if (error instanceof VideoModelResponseError) {
          attempt.finishReason = error.finishReason;
          attempt.outputTokens = error.outputTokens;
        }
        const issues = error instanceof z.ZodError
          ? error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          : [];
        const code = error instanceof Error && /^[A-Z_]{1,64}:/.test(error.message)
          ? error.message.split(":")[0]
          : error instanceof z.ZodError ? "INVALID_STAGE_SCHEMA" : status ? `MODEL_HTTP_${status}` : "MODEL_REQUEST_FAILED";
        attempt.issueCodes = [code];
        if (issues.length) feedback = ["Corrige el schema de salida:", ...issues];
        else if (code === "STORYBOARD_TAKE_MAPPING" || code === "UNKNOWN_SOURCE_REFS") {
          feedback = [(error as Error).message];
        }
        if ([429, 502, 503, 504].includes(status) && index < VIDEO_GENERATION_LIMITS.attemptsPerStage - 1) {
          await wait(Math.max(0, Math.min(VIDEO_GENERATION_LIMITS.retryBackoffMs * (index + 1), deadline - now())));
        }
      } finally {
        attempt.elapsedMs = now() - startedAt;
        attempts.push(attempt);
      }
    }
    return null;
  }

  const script = await runStage("script", (content) => {
    const draft = videoScriptDraftSchema.parse(content);
    if (draft.source_refs_used.some((ref) => !allowedSources.has(ref))) {
      throw new Error("UNKNOWN_SOURCE_REFS: Usa únicamente los IDs de fuentes recibidos en DATOS DE ENTRADA.");
    }
    const video = normalizeScript(draft, contract);
    const validation = validateVideoDurationContent(video, contract, "script");
    // Verify that a valid script can be partitioned before accepting this stage.
    const narration = validation.valid ? buildStoryboardNarration(video, contract) : [];
    return {
      value: { video, narration, sourceRefs: draft.source_refs_used },
      draft,
      issues: validation.issues,
      score: validation.valid ? -1 : Math.abs(validation.narrationCharacterCount - budget.target) / budget.target + validation.issues.length,
      narrationCharacterCount: validation.narrationCharacterCount,
      durationSeconds: validation.scriptDurationSeconds,
    };
  });
  if (!script) return failedResult(componentType, "script", attempts);

  const narration = script.narration;
  const storyboard = await runStage("storyboard", (content) => {
    const draft = videoStoryboardDraftSchema(componentType).parse(content);
    const video = { ...script.video, storyboard: assembleStoryboard(narration, draft) };
    const validation = validateVideoDurationContent(video, contract);
    return {
      value: video, draft, issues: validation.issues, score: validation.issues.length,
      narrationCharacterCount: validation.narrationCharacterCount,
      durationSeconds: validation.scriptDurationSeconds,
    };
  }, narration);
  if (!storyboard) return failedResult(componentType, "storyboard", attempts);
  return { success: true, content: storyboard, sourceRefs: script.sourceRefs, attempts };
}

function normalizeScript(draft: VideoScriptDraft, contract: VideoDurationContract): VideoGuideContent {
  const video: VideoGuideContent = {
    title: draft.title,
    ...(draft.parallel_exercise ? { parallel_exercise: draft.parallel_exercise } : {}),
    duration_estimate_minutes: 0,
    script: {
      sections: draft.script.sections.map((section, index) => ({
        ...section,
        narration_text: section.narration_text.replace(/\s+/g, " ").trim(),
        section_number: index + 1,
        duration_seconds: 0,
        timecode_start: "00:00",
        timecode_end: "00:00",
      })),
    },
    storyboard: [],
  };
  return normalizeVideoDurationContent(video, contract) as VideoGuideContent;
}

function failedResult(componentType: VideoComponentType, stage: VideoGenerationStage, attempts: VideoGenerationAttempt[]): VideoGenerationResult {
  const codes = [...new Set(attempts.filter((attempt) => attempt.stage === stage).flatMap((attempt) => attempt.issueCodes))];
  return {
    success: false,
    error: `${componentType}/GENERATION_FAILED: No se pudo validar la etapa ${stage} dentro del límite de intentos y tiempo. ${codes.join(", ")}`,
    attempts,
  };
}
