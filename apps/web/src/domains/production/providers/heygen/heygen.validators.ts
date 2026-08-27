import { z } from "zod";

const heygenBackgroundSchema = z
  .object({
    asset_id: z.string().trim().min(1).optional(),
    url: z.string().url().optional(),
    value: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (background) =>
      Boolean(background.asset_id || background.url || background.value),
    "El background debe incluir asset_id, url o value.",
  );

export const heygenApiErrorPayloadSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    error: z.unknown().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export const heygenSyncResponseSchema = z.object({
  avatarCount: z.number().int().min(0),
  defaultAvatarPresetId: z.string().uuid().nullable(),
  defaultVoicePresetId: z.string().uuid().nullable(),
  organizationId: z.string().uuid(),
  syncedAt: z.string().datetime(),
  voiceCount: z.number().int().min(0),
});

export const heygenGenerateVideoRequestSchema = z
  .object({
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    autoPromote: z.boolean().default(false),
    avatarPresetId: z.string().uuid().optional(),
    background: heygenBackgroundSchema.optional(),
    caption: z.boolean().default(false),
    componentId: z.string().uuid(),
    engine: z.enum(["avatar_iv", "avatar_v"]).default("avatar_iv"),
    outputFormat: z.enum(["mp4", "webm"]).default("mp4"),
    resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"),
    voicePresetId: z.string().uuid().optional(),
  })
  .strict();

export const heygenAvatarClipStatusSchema = z.enum([
  "DRAFT",
  "WAITING_PROVIDER",
  "COMPLETED",
  "FAILED",
  "STALE",
]);

export const heygenAvatarClipSchema = z
  .object({
    avatar_preset_id: z.string().uuid().optional(),
    background: heygenBackgroundSchema.optional(),
    duration: z.number().positive().optional(),
    error_message: z.string().trim().optional(),
    external_id: z.string().trim().optional(),
    file_name: z.string().trim().optional(),
    has_audio: z.boolean().optional(),
    id: z.string().trim().min(1),
    deleted: z.boolean().optional(),
    job_id: z.string().uuid().optional(),
    order: z.number().int().min(1),
    origin: z.enum(["storyboard", "manual"]).optional(),
    provider: z.string().trim().optional(),
    public_url: z.string().url().optional(),
    script_text: z.string().trim().min(1),
    script_hash: z.string().trim().optional(),
    source_hash: z.string().trim().optional(),
    status: heygenAvatarClipStatusSchema,
    storage_path: z.string().trim().optional(),
    storyboard_take_number: z.number().int().min(1).optional(),
    visual_type: z.string().trim().optional(),
    voice_preset_id: z.string().uuid().optional(),
  })
  .strict();

export const heygenScenesPatchRequestSchema = z
  .object({
    avatarGenerationMode: z.enum(["scene_clips", "single_video"]).optional(),
    clips: z.array(heygenAvatarClipSchema),
    componentId: z.string().uuid(),
  })
  .strict();

export const heygenGenerateClipsRequestSchema = z
  .object({
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    caption: z.boolean().default(false),
    clipIds: z.array(z.string().trim().min(1)).min(1),
    clips: z.array(heygenAvatarClipSchema),
    componentId: z.string().uuid(),
    engine: z.enum(["avatar_iv", "avatar_v"]).default("avatar_iv"),
    outputFormat: z.enum(["mp4", "webm"]).default("mp4"),
    resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"),
  })
  .strict();

export const heygenCreateVideoProviderResponseSchema = z
  .object({
    data: z
      .object({
        output_format: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        video_id: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export const heygenGenerateSpeechProviderResponseSchema = z
  .object({
    data: z.object({
      audio_url: z.string().url(),
      duration: z.number().positive(),
      request_id: z.string().nullable().optional(),
      word_timestamps: z.array(z.object({
        end: z.number().nonnegative(),
        start: z.number().nonnegative(),
        word: z.string(),
      })).nullable().optional(),
    }),
  })
  .passthrough();

export const heygenVideoDetailsProviderResponseSchema = z
  .object({
    data: z.unknown().optional(),
  })
  .passthrough();

export const heygenJobStatusResponseSchema = z.object({
  asset: z
    .object({
      id: z.string().uuid(),
      publicUrl: z.string().url(),
      storagePath: z.string().min(1),
    })
    .nullable(),
  voiceAsset: z
    .object({
      durationSeconds: z.number().positive().nullable(),
      id: z.string().uuid(),
      publicUrl: z.string().url(),
      providerRequestId: z.string().nullable(),
      storagePath: z.string().min(1),
      wordTimestamps: z.array(z.object({
        end: z.number().nonnegative(),
        start: z.number().nonnegative(),
        word: z.string(),
      })),
    })
    .nullable(),
  jobId: z.string().uuid(),
  providerJobId: z.string().nullable(),
  providerErrorCode: z.string().nullable().optional(),
  providerErrorMessage: z.string().nullable().optional(),
  providerStatus: z.string().nullable().optional(),
  scriptHash: z.string().nullable(),
  status: z.string(),
});

export const heygenAvatarLookSchema = z.object({
  avatarType: z.string().nullable().optional(),
  defaultVoiceId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  id: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  name: z.string().min(1),
  previewImageUrl: z.string().url().nullable().optional(),
  previewVideoUrl: z.string().url().nullable().optional(),
  status: z.string().nullable().optional(),
  supportedApiEngines: z.array(z.string()),
});

export const heygenVoiceSchema = z.object({
  gender: z.string().nullable().optional(),
  id: z.string().min(1),
  language: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  name: z.string().min(1),
  previewAudioUrl: z.string().url().nullable().optional(),
  type: z.string().nullable().optional(),
});

export function getStringField(
  source: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function getStringArrayField(
  source: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return [];
}

export function getObjectArrayField(
  source: unknown,
  keys: string[],
): Record<string, unknown>[] {
  const record = toRecord(source);
  if (!record) return [];

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is Record<string, unknown> => Boolean(toRecord(entry)));
    }
  }

  return [];
}

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}
