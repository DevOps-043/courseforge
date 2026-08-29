import { z } from "zod";

const internalMediaUrlSchema = z.string().refine((value) => {
  if (value.startsWith("/api/storage/media?")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, "Debe ser una URL HTTP(S) o una ruta interna de medios autorizada.");

// Schema for Voice Audio asset
export const voiceAudioSchema = z.object({
  storage_path: z.string().trim(),
  public_url: internalMediaUrlSchema,
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  external_id: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  script_hash: z.string().trim().optional(),
  word_timestamps: z.array(z.object({
    end: z.number().nonnegative(),
    start: z.number().nonnegative(),
    word: z.string(),
  })).optional(),
  last_uploaded_at: z.string().datetime().optional(),
});

// Schema for Background Music asset
export const backgroundMusicSchema = z.object({
  storage_path: z.string().trim(),
  public_url: internalMediaUrlSchema,
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  volume_multiplier: z.number().min(0).max(1).default(0.15),
});

// Schema for B-roll Video clips
export const bRollClipSchema = z.object({
  id: z.string().trim(),
  storage_path: z.string().trim(),
  public_url: internalMediaUrlSchema,
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  height: z.number().int().positive().max(16_384).optional(),
  has_audio: z.boolean().optional(),
  prompt_used: z.string().trim().optional(),
  order: z.number().int().min(1),
  width: z.number().int().positive().max(16_384).optional(),
});

export const avatarGenerationModeSchema = z.enum([
  "scene_clips",
  "single_video",
  "voiceover",
]);

export const detachedAudioClipSchema = z.object({
  content_type: z.literal("audio/wav").default("audio/wav"),
  detached_from_asset_id: z.string().uuid(),
  detached_from_clip_id: z.string().trim().min(1),
  duration: z.number().positive(),
  file_name: z.string().trim().min(1),
  has_audio: z.literal(true).default(true),
  public_url: z.string().url().nullable().optional(),
  storage_path: z.string().trim().min(1),
});

export const avatarClipStatusSchema = z.enum([
  "DRAFT",
  "WAITING_PROVIDER",
  "COMPLETED",
  "FAILED",
  "STALE",
]);

export const avatarClipBackgroundSchema = z.object({
  value: z.string().trim().optional(),
  url: z.string().url().optional(),
  asset_id: z.string().trim().optional(),
});

export const avatarClipSchema = z.object({
  id: z.string().trim(),
  order: z.number().int().min(1),
  asset_name: z.string().trim().min(1).max(120).optional(),
  generation_revision: z.number().int().min(0).optional(),
  deleted: z.boolean().optional(),
  origin: z.enum(["storyboard", "manual"]).optional(),
  storyboard_take_number: z.number().int().min(1).optional(),
  visual_type: z.string().trim().optional(),
  script_text: z.string().trim(),
  avatar_preset_id: z.string().trim().optional(),
  voice_preset_id: z.string().trim().optional(),
  voice_speed: z.number().min(0.5).max(2).optional(),
  background: avatarClipBackgroundSchema.optional(),
  public_url: internalMediaUrlSchema.optional(),
  storage_path: z.string().trim().optional(),
  file_name: z.string().trim().optional(),
  has_audio: z.boolean().optional(),
  duration: z.number().positive().optional(),
  provider: z.string().trim().optional(),
  external_id: z.string().trim().optional(),
  job_id: z.string().trim().optional(),
  status: avatarClipStatusSchema,
  error_message: z.string().trim().optional(),
  voice_status: avatarClipStatusSchema.optional(),
  voice_error_message: z.string().trim().optional(),
  script_hash: z.string().trim().optional(),
  source_hash: z.string().trim().optional(),
});

export const voiceClipSchema = z.object({
  asset_id: z.string().uuid().optional(),
  id: z.string().trim(),
  clip_id: z.string().trim(),
  order: z.number().int().min(1),
  storage_path: z.string().trim().optional(),
  public_url: internalMediaUrlSchema.optional(),
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  external_id: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  script_hash: z.string().trim(),
  word_timestamps: z.array(z.object({
    end: z.number().nonnegative(),
    start: z.number().nonnegative(),
    word: z.string(),
  })).optional(),
  status: z.enum(["DRAFT", "COMPLETED", "FAILED", "STALE"]),
  error_message: z.string().trim().optional(),
});

// Schema for Avatar Video asset (talking head)
export const avatarVideoSchema = z.object({
  storage_path: z.string().trim(),
  public_url: internalMediaUrlSchema,
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  height: z.number().int().positive().max(16_384).optional(),
  has_audio: z.boolean().optional(),
  provider: z.string().trim().optional(),
  external_id: z.string().trim().optional(),
  script_hash: z.string().trim().optional(),
  sync_status: z.enum(["SYNCING", "COMPLETED", "FAILED"]).optional(),
  width: z.number().int().positive().max(16_384).optional(),
});

// Schema for individual Slide Image
export const slideImageSchema = z.object({
  slide_index: z.number().int().min(0),
  storage_path: z.string().trim(),
  public_url: z.string().url(),
  file_name: z.string().trim().optional(),
  content_type: z.string().trim().optional(),
  height: z.number().int().positive().max(16_384).optional(),
  width: z.number().int().positive().max(16_384).optional(),
});

export const animatedDeckFontSchema = z.object({
  family: z.string().trim().min(1),
  href: z.string().url(),
  source: z.literal("google"),
  weights: z.array(z.string().trim()).optional(),
});

export const animatedDeckRemoteAssetSchema = z.object({
  bytes: z.number().int().nonnegative(),
  content_type: z.string().trim(),
  public_url: z.string().url(),
  source_url: z.string().url(),
  storage_path: z.string().trim(),
  status: z.enum(["imported", "placeholder"]).optional(),
  fallback_reason: z.string().trim().optional(),
});

export const animatedDeckSlideSchema = z.object({
  animationCount: z.number().int().min(0),
  classes: z.string().trim(),
  html: z.string(),
  index: z.number().int().min(1),
  label: z.string().trim(),
});

export const animatedDeckSchema = z.object({
  animated_slide_count: z.number().int().min(0),
  cleanup_report: z.record(z.string(), z.unknown()),
  css: z.string(),
  deck_css_path: z.string().trim().optional(),
  deck_json_path: z.string().trim().optional(),
  error_message: z.string().trim().optional(),
  fonts: z.array(animatedDeckFontSchema),
  generated_at: z.string().optional(),
  height: z.number().int().positive(),
  remote_assets: z.array(animatedDeckRemoteAssetSchema).optional(),
  slide_count: z.number().int().min(0),
  slides: z.array(animatedDeckSlideSchema),
  source: z.enum(["manual_upload", "open_design_import"]),
  source_html_path: z.string().trim(),
  static_slide_count: z.number().int().min(0),
  status: z.enum(["PENDING", "VALIDATING", "READY_FOR_PREVIEW", "READY_FOR_RENDER", "FAILED"]),
  validation_report: z.record(z.string(), z.unknown()),
  width: z.number().int().positive(),
});

// Schema for Slides asset group
export const slidesSchema = z.object({
  appearance: z.enum(["light", "dark"]).optional(),
  open_design_project_id: z.string().trim().optional(),
  html_content_path: z.string().trim().optional(),
  html_public_url: z.string().url().optional(),
  qa_content_path: z.string().trim().optional(),
  qa_report: z.record(z.string(), z.unknown()).optional(),
  selected_slide_template_run_id: z.string().trim().optional(),
  selected_slide_template_title: z.string().trim().nullable().optional(),
  spec_content_path: z.string().trim().optional(),
  animated_deck: animatedDeckSchema.optional(),
  images: z.array(slideImageSchema).optional(),
});

// Production status enum
export const productionStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "DECK_READY",
  "EXPORTED",
  "COMPLETED",
]);

// Main Material Assets schema matching MaterialAssets interface
export const materialAssetsSchema = z.object({
  slides_url: z.string().url().or(z.literal("")).optional(),
  b_roll_prompts: z.string().trim().optional(),
  video_url: z.string().url().or(z.literal("")).optional(),
  screencast_url: z.string().url().or(z.literal("")).optional(),
  notes: z.string().trim().optional(),
  final_video_url: z.string().url().or(z.literal("")).optional(),
  final_video_source: z.enum(["upload", "link", "desktop_worker"]).optional(),
  final_video_file_name: z.string().trim().optional(),
  final_video_storage_path: z.string().trim().optional(),
  final_video_layout_stale: z.boolean().optional(),
  final_video_assembly_stale: z.boolean().optional(),
  video_duration: z.number().nonnegative().optional(),
  layout_overrides: z.array(z.record(z.string(), z.unknown())).optional(),
  layout_overrides_updated_at: z.string().optional(),
  timeline_overrides: z.array(z.record(z.string(), z.unknown())).optional(),
  timeline_overrides_updated_at: z.string().optional(),
  production_status: productionStatusSchema.optional(),
  gamma_deck_id: z.string().trim().optional(),
  png_export_path: z.string().trim().optional(),
  updated_at: z.string().optional(),
  
  // New structured visual assets
  voice_audio: voiceAudioSchema.optional(),
  voice_clips: z.array(voiceClipSchema).optional(),
  background_music: backgroundMusicSchema.optional(),
  detached_audio_clips: z.array(detachedAudioClipSchema).optional(),
  b_roll_clips: z.array(bRollClipSchema).optional(),
  avatar_generation_mode: avatarGenerationModeSchema.optional(),
  avatar_clips: z.array(avatarClipSchema).optional(),
  avatar_video: avatarVideoSchema.nullable().optional(),
  slides: slidesSchema.optional(),
}).superRefine((assets, context) => {
  const seenClipIds = new Set<string>();
  for (const [index, voiceClip] of (assets.voice_clips || []).entries()) {
    if (seenClipIds.has(voiceClip.clip_id)) {
      context.addIssue({
        code: "custom",
        message: "Cada escena puede tener un solo clip de voz activo.",
        path: ["voice_clips", index, "clip_id"],
      });
    }
    seenClipIds.add(voiceClip.clip_id);
  }

  const avatarById = new Map((assets.avatar_clips || []).map((clip) => [clip.id, clip]));
  for (const [index, voiceClip] of (assets.voice_clips || []).entries()) {
    const avatarClip = avatarById.get(voiceClip.clip_id);
    if (
      voiceClip.status === "COMPLETED"
      && avatarClip?.script_hash
      && avatarClip.script_hash !== voiceClip.script_hash
    ) {
      context.addIssue({
        code: "custom",
        message: "La voz completada no corresponde al guion vigente del clip de avatar.",
        path: ["voice_clips", index, "script_hash"],
      });
    }
  }
});

export type VoiceAudio = z.infer<typeof voiceAudioSchema>;
export type VoiceClip = z.infer<typeof voiceClipSchema>;
export type BackgroundMusic = z.infer<typeof backgroundMusicSchema>;
export type BRollClip = z.infer<typeof bRollClipSchema>;
export type AvatarGenerationMode = z.infer<typeof avatarGenerationModeSchema>;
export type AvatarClip = z.infer<typeof avatarClipSchema>;
export type AvatarVideo = z.infer<typeof avatarVideoSchema>;
export type SlideImage = z.infer<typeof slideImageSchema>;
export type SlidesAsset = z.infer<typeof slidesSchema>;
export type MaterialAssetsValidated = z.infer<typeof materialAssetsSchema>;

export function parseMaterialAssets(rawJson: unknown): MaterialAssetsValidated {
  return materialAssetsSchema.parse(rawJson);
}

export function safeParseMaterialAssets(rawJson: unknown) {
  return materialAssetsSchema.safeParse(rawJson);
}
