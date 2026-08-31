import type { SupabaseClient } from "@supabase/supabase-js";

export const HEYGEN_API_BASE_URL = "https://api.heygen.com";
export const HEYGEN_DEFAULT_PAGE_SIZE = 50;
export const HEYGEN_MAX_IMPORT_SIZE_BYTES = 150 * 1024 * 1024;
// Create-video acknowledgements can take longer than 20 seconds, especially for
// higher resolutions.  Keep this below the request ceiling while allowing one
// idempotent retry in the client.
export const HEYGEN_REQUEST_TIMEOUT_MS = 30_000;
export const HEYGEN_VIDEO_IMPORT_TIMEOUT_MS = 45_000;
export const HEYGEN_AUDIO_IMPORT_TIMEOUT_MS = 30_000;
export const HEYGEN_MAX_AUDIO_IMPORT_SIZE_BYTES = 50 * 1024 * 1024;
export const HEYGEN_VIDEO_STORAGE_BUCKET = "production-assets";
export const HEYGEN_ALLOWED_VIDEO_HOSTS = [
  "heygen.com",
  "heygen.ai",
  "cdn.heygen.com",
  // HyperFrames completed renders currently use this exact HeyGen-owned S3
  // endpoint. Keep it explicit; allowing amazonaws.com would weaken SSRF controls.
  "heygen-product.s3.amazonaws.com",
  "resource.heygen.com",
  "files2.heygen.ai",
] as const;
export const HEYGEN_ALLOWED_AUDIO_HOSTS = [
  "heygen.com",
  "heygen.ai",
  "cdn.heygen.com",
  "resource.heygen.ai",
  "resource2.heygen.ai",
  "files2.heygen.ai",
] as const;

export const HEYGEN_VIDEO_STATUSES = {
  COMPLETED: "completed",
  FAILED: "failed",
  PENDING: "pending",
  PROCESSING: "processing",
} as const;

export type HeygenVideoStatus =
  (typeof HEYGEN_VIDEO_STATUSES)[keyof typeof HEYGEN_VIDEO_STATUSES] | string;

export type HeygenAvatarVideoEngine = "avatar_iv" | "avatar_v";
export type HeygenAvatarVideoResolution = "720p" | "1080p" | "4k";
export type HeygenAvatarVideoAspectRatio = "16:9" | "9:16";
export type HeygenAvatarVideoOutputFormat = "mp4" | "webm";

export type HeygenAssetReference =
  | { type: "asset_id"; asset_id: string }
  | { type: "url"; url: string };

export interface HeygenPage<T = Record<string, unknown>> {
  data: T[];
  hasMore: boolean;
  nextToken: string | null;
  raw: Record<string, unknown>;
}

export interface HeygenAccountSummary {
  billingType: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  raw: Record<string, unknown>;
  subscription: Record<string, unknown> | null;
  usageBased: Record<string, unknown> | null;
  username: string;
  wallet: Record<string, unknown> | null;
}

export type HeygenPlatformOperationType =
  | "AI_CLIPPING"
  | "BRAND_GLOSSARY"
  | "BRAND_KIT"
  | "FILLER_REMOVAL"
  | "LIPSYNC"
  | "PROOFREAD"
  | "TEMPLATE_VIDEO"
  | "VIDEO_AGENT"
  | "VIDEO_BATCH"
  | "VIDEO_TRANSLATION"
  | "VOICE_CLONE"
  | "VOICE_DESIGN";

export interface HeygenAvatarLook {
  avatarType?: string | null;
  defaultVoiceId?: string | null;
  groupId?: string | null;
  id: string;
  metadata: Record<string, unknown>;
  name: string;
  previewImageUrl?: string | null;
  previewVideoUrl?: string | null;
  status?: string | null;
  supportedApiEngines: string[];
}

export interface HeygenVoice {
  gender?: string | null;
  id: string;
  language?: string | null;
  metadata: Record<string, unknown>;
  name: string;
  previewAudioUrl?: string | null;
  type?: string | null;
}

export interface HeygenCatalogSyncResult {
  avatarCount: number;
  defaultAvatarPresetId: string | null;
  defaultVoicePresetId: string | null;
  organizationId: string;
  syncedAt: string;
  voiceCount: number;
}

export interface HeygenAvatarVideoBackground {
  asset_id?: string;
  url?: string;
  value?: string;
}

export interface HeygenCreateVideoRequest {
  aspect_ratio: HeygenAvatarVideoAspectRatio;
  avatar_id: string;
  background?: HeygenAvatarVideoBackground;
  callback_id?: string;
  callback_url?: string;
  caption?: {
    file_format: "srt";
    style: "default";
  };
  engine?: {
    type: HeygenAvatarVideoEngine;
    reference_look_id?: string;
  };
  brand_glossary_id?: string;
  folder_id?: string;
  motion_prompt?: string;
  remove_background?: boolean;
  watermark?: Record<string, unknown>;
  output_format: HeygenAvatarVideoOutputFormat;
  resolution: HeygenAvatarVideoResolution;
  audio_url?: string;
  script?: string;
  title: string;
  type: "avatar";
  voice_id?: string;
  voice_settings?: {
    locale?: string;
    pitch?: number;
    speed?: number;
    volume?: number;
  };
}

export interface HeygenWordTimestamp {
  end: number;
  start: number;
  word: string;
}

export interface HeygenGenerateSpeechRequest {
  input_type?: "ssml" | "text";
  language?: string;
  locale?: string;
  speed: number;
  text: string;
  voice_id: string;
}

export interface HeygenGeneratedSpeech {
  audioUrl: string;
  durationSeconds: number;
  raw: Record<string, unknown>;
  requestId?: string | null;
  wordTimestamps: HeygenWordTimestamp[];
}

export interface HeygenCreateVideoResponse {
  outputFormat?: string | null;
  providerStatus?: string | null;
  raw: Record<string, unknown>;
  videoId: string;
}

export interface HeygenVideoDetails {
  captionedVideoUrl?: string | null;
  durationSeconds?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  gifUrl?: string | null;
  outputFormat?: string | null;
  raw: Record<string, unknown>;
  status: HeygenVideoStatus;
  subtitleUrl?: string | null;
  thumbnailUrl?: string | null;
  videoId: string;
  videoPageUrl?: string | null;
  videoUrl?: string | null;
}

export interface HeygenVideoCatalogItem {
  createdAt?: number | string | null;
  status: HeygenVideoStatus;
  title?: string | null;
  videoId: string;
}

export interface HeygenAvatarVideoGenerationOptions {
  aspectRatio: HeygenAvatarVideoAspectRatio;
  autoPromote: boolean;
  avatarPresetId?: string;
  background?: HeygenAvatarVideoBackground;
  caption: boolean;
  componentId: string;
  engine: HeygenAvatarVideoEngine;
  outputFormat: HeygenAvatarVideoOutputFormat;
  resolution: HeygenAvatarVideoResolution;
  brandGlossaryId?: string;
  callbackUrl?: string;
  folderId?: string;
  locale?: string;
  motionPrompt?: string;
  pitch?: number;
  referenceLookId?: string;
  removeBackground?: boolean;
  speed?: number;
  volume?: number;
  voicePresetId?: string;
}

export interface HeygenVoiceoverGenerationOptions {
  componentId: string;
  inputType?: "ssml" | "text";
  language?: string;
  locale?: string;
  speed: number;
  voicePresetId?: string;
}

export interface HeygenAvatarPresetRow {
  default_voice_id?: string | null;
  heygen_avatar_look_id: string;
  id: string;
  is_default: boolean;
}

export interface HeygenAvatarPresetGenerationRow extends HeygenAvatarPresetRow {
  metadata?: Record<string, unknown> | null;
  name: string;
  supported_api_engines?: string[] | null;
}

export interface HeygenVoicePresetRow {
  heygen_voice_id: string;
  id: string;
  is_default: boolean;
}

export interface HeygenVoicePresetGenerationRow extends HeygenVoicePresetRow {
  name: string;
}

export interface HeygenProductionJobRow {
  artifact_id: string;
  created_at?: string | null;
  duration_seconds?: number | null;
  id: string;
  input_snapshot?: Record<string, unknown> | null;
  job_type?: string | null;
  material_component_id?: string | null;
  material_lesson_id?: string | null;
  lesson_id?: string | null;
  module_id?: string | null;
  organization_id?: string | null;
  output_snapshot?: Record<string, unknown> | null;
  provider_job_id?: string | null;
  provider_error?: Record<string, unknown> | null;
  provider_model?: string | null;
  status: string;
  updated_at?: string | null;
}

export interface HeygenProductionAssetRow {
  duration_milliseconds?: number | null;
  duration_seconds?: number | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  mime_type?: string | null;
  public_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
}

export type HeygenSupabaseClient = SupabaseClient<any, "public", any>;
