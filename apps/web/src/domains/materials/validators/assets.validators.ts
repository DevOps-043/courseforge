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
  final_video_source: z.enum(["upload", "link"]).optional(),
  video_duration: z.number().nonnegative().optional(),
  production_status: productionStatusSchema.optional(),
  gamma_deck_id: z.string().trim().optional(),
  png_export_path: z.string().trim().optional(),
  updated_at: z.string().optional(),
  
  // New structured visual assets
  voice_audio: voiceAudioSchema.optional(),
  background_music: backgroundMusicSchema.optional(),
  b_roll_clips: z.array(bRollClipSchema).optional(),
  avatar_video: avatarVideoSchema.optional(),
  slides: slidesSchema.optional(),
});

export type VoiceAudio = z.infer<typeof voiceAudioSchema>;
export type BackgroundMusic = z.infer<typeof backgroundMusicSchema>;
export type BRollClip = z.infer<typeof bRollClipSchema>;
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
