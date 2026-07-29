import { z } from "zod";

// Schema for Voice Audio asset
export const voiceAudioSchema = z.object({
  storage_path: z.string().trim(),
  public_url: z.string().url(),
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  provider: z.string().trim().optional(),
  last_uploaded_at: z.string().datetime().optional(),
});

// Schema for Background Music asset
export const backgroundMusicSchema = z.object({
  storage_path: z.string().trim(),
  public_url: z.string().url(),
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  volume_multiplier: z.number().min(0).max(1).default(0.15),
});

// Schema for B-roll Video clips
export const bRollClipSchema = z.object({
  id: z.string().trim(),
  storage_path: z.string().trim(),
  public_url: z.string().url(),
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  prompt_used: z.string().trim().optional(),
  order: z.number().int().min(1),
});

export const avatarGenerationModeSchema = z.enum([
  "scene_clips",
  "single_video",
]);

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
  storyboard_take_number: z.number().int().min(1).optional(),
  visual_type: z.string().trim().optional(),
  script_text: z.string().trim(),
  avatar_preset_id: z.string().trim().optional(),
  voice_preset_id: z.string().trim().optional(),
  background: avatarClipBackgroundSchema.optional(),
  public_url: z.string().url().optional(),
  storage_path: z.string().trim().optional(),
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  provider: z.string().trim().optional(),
  external_id: z.string().trim().optional(),
  job_id: z.string().trim().optional(),
  status: avatarClipStatusSchema,
  error_message: z.string().trim().optional(),
  source_hash: z.string().trim().optional(),
});

// Schema for Avatar Video asset (talking head)
export const avatarVideoSchema = z.object({
  storage_path: z.string().trim(),
  public_url: z.string().url(),
  file_name: z.string().trim().optional(),
  duration: z.number().positive().optional(),
  provider: z.string().trim().optional(),
  external_id: z.string().trim().optional(),
  sync_status: z.enum(["SYNCING", "COMPLETED", "FAILED"]).optional(),
});

// Schema for individual Slide Image
export const slideImageSchema = z.object({
  slide_index: z.number().int().min(0),
  storage_path: z.string().trim(),
  public_url: z.string().url(),
  file_name: z.string().trim().optional(),
  content_type: z.string().trim().optional(),
});

// Schema for Slides asset group
export const slidesSchema = z.object({
  open_design_project_id: z.string().trim().optional(),
  html_content_path: z.string().trim().optional(),
  html_public_url: z.string().url().optional(),
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
  background_music: backgroundMusicSchema.optional(),
  b_roll_clips: z.array(bRollClipSchema).optional(),
  avatar_generation_mode: avatarGenerationModeSchema.optional(),
  avatar_clips: z.array(avatarClipSchema).optional(),
  avatar_video: avatarVideoSchema.optional(),
  slides: slidesSchema.optional(),
});

export type VoiceAudio = z.infer<typeof voiceAudioSchema>;
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
