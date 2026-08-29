export const PRODUCTION_JOB_TYPES = {
  BROLL_PROMPT_GENERATION: "BROLL_PROMPT_GENERATION",
  HEYGEN_AVATAR_CLIP: "HEYGEN_AVATAR_CLIP",
  HEYGEN_AVATAR_VIDEO: "HEYGEN_AVATAR_VIDEO",
  HEYGEN_VOICEOVER: "HEYGEN_VOICEOVER",
  HYPERFRAMES_RENDER: "HYPERFRAMES_RENDER",
  REMOTION_RENDER: "REMOTION_RENDER",
  SLIDE_DECK_GENERATION: "SLIDE_DECK_GENERATION",
  SLIDE_DECK_EXPORT: "SLIDE_DECK_EXPORT",
  SLIDE_DECK_PREPARE: "SLIDE_DECK_PREPARE",
  SLIDE_BACKGROUND_GENERATION: "SLIDE_BACKGROUND_GENERATION",
  SLIDE_SUPPORTING_IMAGE_GENERATION: "SLIDE_SUPPORTING_IMAGE_GENERATION",
} as const;

export const PRODUCTION_ASSET_TYPES = {
  VOICE_AUDIO: "VOICE_AUDIO",
  AVATAR_VIDEO_CLIP: "AVATAR_VIDEO_CLIP",
  AVATAR_VIDEO: "AVATAR_VIDEO",
  BROLL_PROMPTS: "BROLL_PROMPTS",
  SLIDE_CHART_SPEC: "SLIDE_CHART_SPEC",
  SLIDE_DECK_HTML: "SLIDE_DECK_HTML",
  SLIDE_DECK_QA_REPORT: "SLIDE_DECK_QA_REPORT",
  SLIDE_DECK_SPEC: "SLIDE_DECK_SPEC",
  SLIDE_IMAGE_SET: "SLIDE_IMAGE_SET",
  SOURCE_MEDIA: "SOURCE_MEDIA",
  FINAL_VIDEO: "FINAL_VIDEO",
} as const;

export const PRODUCTION_PROVIDERS = {
  GEMINI: "gemini",
  HEYGEN: "heygen",
  HYPERFRAMES: "hyperframes",
  GOOGLE_DRIVE: "google_drive",
  MANUAL: "manual",
  OPENAI: "openai",
  ONEDRIVE: "onedrive",
  REMOTION: "remotion",
  SOFLIA_ENGINE_SLIDES: "soflia_engine_slides",
} as const;

export const PRODUCTION_JOB_STATUSES = {
  PENDING: "PENDING",
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  WAITING_PROVIDER: "WAITING_PROVIDER",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  RETRY_SCHEDULED: "RETRY_SCHEDULED",
} as const;

export const PRODUCTION_QA_STATUSES = {
  PENDING: "PENDING",
  GENERATED: "GENERATED",
  READY_FOR_QA: "READY_FOR_QA",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPORTED: "EXPORTED",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
} as const;

export type ProductionJobType =
  (typeof PRODUCTION_JOB_TYPES)[keyof typeof PRODUCTION_JOB_TYPES];

export type ProductionAssetType =
  (typeof PRODUCTION_ASSET_TYPES)[keyof typeof PRODUCTION_ASSET_TYPES];

export type ProductionProvider =
  (typeof PRODUCTION_PROVIDERS)[keyof typeof PRODUCTION_PROVIDERS];

export type ProductionJobStatus =
  (typeof PRODUCTION_JOB_STATUSES)[keyof typeof PRODUCTION_JOB_STATUSES];

export type ProductionQaStatus =
  (typeof PRODUCTION_QA_STATUSES)[keyof typeof PRODUCTION_QA_STATUSES];

export interface ProductionComponentContext {
  artifactId: string;
  artifactTitle?: string | null;
  componentId: string;
  componentType: string;
  lessonId: string | null;
  lessonTitle?: string | null;
  materialLessonId: string | null;
  moduleId: string | null;
  moduleTitle?: string | null;
  organizationId: string | null;
}

export interface ProductionJobRecord {
  attempt?: number;
  id: string;
  output_snapshot?: Record<string, unknown> | null;
  provider_job_id?: string | null;
  status: ProductionJobStatus;
}

export interface CreateProductionJobParams {
  context: ProductionComponentContext;
  createdBy?: string | null;
  idempotencyKey: string;
  inputSnapshot: Record<string, unknown>;
  jobType: ProductionJobType;
  provider: ProductionProvider;
  providerModel?: string | null;
}

export interface CompleteBrollPromptJobParams {
  context: ProductionComponentContext;
  jobId: string;
  model: string;
  promptsText: string;
  promptItems: unknown[];
  slideDeckSpec?: Record<string, unknown>;
}
