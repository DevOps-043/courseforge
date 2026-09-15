import { z } from "zod";
import type { VideoComponentType } from "../../video-duration/video-duration-policy";

export const VIDEO_GENERATION_LIMITS = Object.freeze({
  attemptsPerStage: 3,
  requestTimeoutMs: 120_000,
  totalTimeoutMs: 480_000,
  lessonTimeoutMs: 720_000,
  retryBackoffMs: 15_000,
  maximumOutputTokens: 16_000,
  maximumSections: 60,
  maximumTakes: 360,
});

const text = z.string().trim().min(1);
const sectionSchema = z.object({
  section_type: text,
  narration_text: text.max(60_000),
  on_screen_text: text,
  on_screen_action: z.string().optional(),
  visual_notes: text,
  reflection_question: z.string().optional(),
  best_practices: z.array(z.string()).optional(),
  common_errors: z.array(z.string()).optional(),
  success_criteria: z.string().optional(),
});

export const videoScriptDraftSchema = z.object({
  title: text,
  script: z.object({
    sections: z.array(sectionSchema).min(1).max(VIDEO_GENERATION_LIMITS.maximumSections),
  }),
  parallel_exercise: z.object({
    title: text,
    instructions: text,
    steps: z.array(z.object({
      step_number: z.number().int().positive(),
      instruction: text,
      expected_result: z.string().optional(),
    })).min(1),
  }).optional(),
  source_refs_used: z.array(z.string()),
});

export const VIDEO_VISUAL_TYPES = {
  VIDEO_THEORETICAL: ["slide", "text", "iconography", "diagram", "b_roll"],
  VIDEO_DEMO: ["capture", "screen_recording", "zoom", "highlight", "split_screen", "b_roll"],
  VIDEO_GUIDE: ["step_capture", "instruction_box", "success_criteria", "comparison", "b_roll"],
} as const;

export function videoStoryboardDraftSchema(componentType: VideoComponentType) {
  return z.object({
    storyboard: z.array(z.object({
      take_number: z.number().int().positive(),
      visual_type: z.enum(VIDEO_VISUAL_TYPES[componentType]),
      visual_content: text,
      on_screen_action: z.string().optional(),
      on_screen_text: text,
      operational_notes: z.string().optional(),
      success_criteria_visible: z.string().optional(),
    })).min(1).max(VIDEO_GENERATION_LIMITS.maximumTakes),
  });
}

export type VideoScriptDraft = z.infer<typeof videoScriptDraftSchema>;
export type VideoStoryboardDraft = z.infer<ReturnType<typeof videoStoryboardDraftSchema>>;
export type VideoGenerationStage = "script" | "storyboard";

export interface VideoGenerationAttempt {
  stage: VideoGenerationStage;
  attempt: number;
  model: string;
  outcome: "valid" | "invalid" | "request_failed";
  issueCodes: string[];
  narrationCharacterCount?: number;
  durationSeconds?: number;
  finishReason?: string | null;
  outputTokens?: number;
  elapsedMs: number;
}

export interface VideoModelResponse {
  content: unknown;
  finishReason?: string | null;
  outputTokens?: number;
}

export class VideoModelResponseError extends Error {
  constructor(
    readonly code: string,
    readonly finishReason?: string | null,
    readonly outputTokens?: number,
  ) {
    super(`${code}: El proveedor no entregó un JSON completo y válido.`);
    this.name = "VideoModelResponseError";
  }
}

export type VideoModelRequest = (request: {
  model: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<VideoModelResponse>;
