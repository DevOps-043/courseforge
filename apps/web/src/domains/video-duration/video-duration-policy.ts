import { z } from "zod";

export const VIDEO_COMPONENT_TYPES = [
  "VIDEO_THEORETICAL",
  "VIDEO_DEMO",
  "VIDEO_GUIDE",
] as const;

export type VideoComponentType = (typeof VIDEO_COMPONENT_TYPES)[number];

export const videoDurationPolicySchema = z.object({
  maximumDurationSeconds: z.number().int().min(60).max(3_600),
  minimumDurationSeconds: z.number().int().min(60).max(3_600),
  narrationWordsPerMinute: z.number().int().min(90).max(220),
  targetDurationSeconds: z.number().int().min(60).max(3_600),
  version: z.literal(1),
  visualBeatCadenceSeconds: z.number().int().min(10).max(90),
}).superRefine((policy, context) => {
  if (policy.minimumDurationSeconds > policy.targetDurationSeconds) {
    context.addIssue({
      code: "custom",
      message: "La duración mínima no puede superar la duración objetivo.",
      path: ["minimumDurationSeconds"],
    });
  }

  if (policy.targetDurationSeconds > policy.maximumDurationSeconds) {
    context.addIssue({
      code: "custom",
      message: "La duración objetivo no puede superar la duración máxima.",
      path: ["targetDurationSeconds"],
    });
  }
});

export type VideoDurationPolicy = z.infer<typeof videoDurationPolicySchema>;

export const DEFAULT_VIDEO_DURATION_POLICY: VideoDurationPolicy = Object.freeze({
  maximumDurationSeconds: 8 * 60,
  minimumDurationSeconds: 6 * 60,
  narrationWordsPerMinute: 145,
  targetDurationSeconds: 7 * 60,
  version: 1,
  visualBeatCadenceSeconds: 25,
});

export const VIDEO_DURATION_PRESETS = [
  { label: "Breve (3–5 min)", maximumDurationSeconds: 300, minimumDurationSeconds: 180, targetDurationSeconds: 240 },
  { label: "Taller (6–8 min)", maximumDurationSeconds: 480, minimumDurationSeconds: 360, targetDurationSeconds: 420 },
  { label: "Profundo (8–10 min)", maximumDurationSeconds: 600, minimumDurationSeconds: 480, targetDurationSeconds: 540 },
  { label: "Extenso (10–12 min)", maximumDurationSeconds: 720, minimumDurationSeconds: 600, targetDurationSeconds: 660 },
] as const;

export const videoDurationContractSchema = videoDurationPolicySchema.extend({
  minimumBrollTakes: z.number().int().min(0).max(60),
  minimumSlideCount: z.number().int().min(1).max(24),
  maximumWordCount: z.number().int().positive(),
  minimumStoryboardTakes: z.number().int().min(1).max(120),
  minimumWordCount: z.number().int().positive(),
  targetWordCount: z.number().int().positive(),
});

export type VideoDurationContract = z.infer<typeof videoDurationContractSchema>;
export type VideoDurationValidationMode = "enforce" | "warn";

export function isVideoComponentType(value: unknown): value is VideoComponentType {
  return typeof value === "string" && VIDEO_COMPONENT_TYPES.includes(value as VideoComponentType);
}

export function resolveVideoDurationPolicy(value: unknown): VideoDurationPolicy {
  const parsed = videoDurationPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_VIDEO_DURATION_POLICY };
}

export function resolveVideoDurationValidationMode(
  value: unknown,
): VideoDurationValidationMode {
  return typeof value === "string" && value.trim().toLowerCase() === "enforce"
    ? "enforce"
    : "warn";
}

export function resolveArtifactVideoDurationPolicy(metadata: unknown): VideoDurationPolicy {
  if (!isRecord(metadata)) return { ...DEFAULT_VIDEO_DURATION_POLICY };

  const directPolicy = metadata.video_duration_policy;
  if (videoDurationPolicySchema.safeParse(directPolicy).success) {
    return resolveVideoDurationPolicy(directPolicy);
  }

  const originalInput = isRecord(metadata.original_input) ? metadata.original_input : null;
  return resolveVideoDurationPolicy(originalInput?.videoDurationPolicy);
}

export function buildVideoDurationContract(
  policyInput: unknown,
  componentType: VideoComponentType = "VIDEO_THEORETICAL",
): VideoDurationContract {
  const policy = resolveVideoDurationPolicy(policyInput);
  const wordsForDuration = (seconds: number) =>
    Math.round((seconds / 60) * policy.narrationWordsPerMinute);

  return {
    ...policy,
    minimumBrollTakes: minimumBrollTakes(policy.targetDurationSeconds, componentType),
    minimumSlideCount: minimumSlideCount(policy.targetDurationSeconds, componentType),
    maximumWordCount: wordsForDuration(policy.maximumDurationSeconds),
    minimumStoryboardTakes: Math.max(
      1,
      Math.ceil(policy.targetDurationSeconds / policy.visualBeatCadenceSeconds),
    ),
    minimumWordCount: wordsForDuration(policy.minimumDurationSeconds),
    targetWordCount: wordsForDuration(policy.targetDurationSeconds),
  };
}

export function formatVideoDurationRange(policyInput: unknown) {
  const policy = resolveVideoDurationPolicy(policyInput);
  return `${formatMinutes(policy.minimumDurationSeconds)}–${formatMinutes(policy.maximumDurationSeconds)} min`;
}

export function buildVideoDurationContractFromText(
  value: string,
  fallbackInput: unknown,
  componentType: VideoComponentType = "VIDEO_THEORETICAL",
): VideoDurationContract | null {
  const matches = value.match(/\d+(?:[.,]\d+)?/g)?.map((item) => Number(item.replace(",", "."))) || [];
  if (matches.length === 0 || matches.some((minutes) => !Number.isFinite(minutes) || minutes < 1 || minutes > 60)) {
    return null;
  }

  const fallback = resolveVideoDurationPolicy(fallbackInput);
  const minimumMinutes = matches.length > 1 ? Math.min(matches[0], matches[1]) : matches[0];
  const maximumMinutes = matches.length > 1 ? Math.max(matches[0], matches[1]) : matches[0];
  const targetMinutes = matches.length > 1 ? (minimumMinutes + maximumMinutes) / 2 : matches[0];
  return buildVideoDurationContract({
    ...fallback,
    maximumDurationSeconds: Math.round(maximumMinutes * 60),
    minimumDurationSeconds: Math.round(minimumMinutes * 60),
    targetDurationSeconds: Math.round(targetMinutes * 60),
  }, componentType);
}

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

function minimumSlideCount(targetDurationSeconds: number, componentType: VideoComponentType) {
  const cadenceSeconds = componentType === "VIDEO_THEORETICAL" ? 50 : 90;
  return Math.min(24, Math.max(4, Math.ceil(targetDurationSeconds / cadenceSeconds)));
}

function minimumBrollTakes(targetDurationSeconds: number, componentType: VideoComponentType) {
  const cadenceSeconds = componentType === "VIDEO_THEORETICAL"
    ? 75
    : componentType === "VIDEO_DEMO" ? 180 : 240;
  return Math.max(1, Math.ceil(targetDurationSeconds / cadenceSeconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
