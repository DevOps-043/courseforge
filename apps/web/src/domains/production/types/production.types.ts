export const PRODUCTION_JOB_TYPES = {
  BROLL_PROMPT_GENERATION: "BROLL_PROMPT_GENERATION",
  REMOTION_RENDER: "REMOTION_RENDER",
} as const;

export const PRODUCTION_ASSET_TYPES = {
  BROLL_PROMPTS: "BROLL_PROMPTS",
} as const;

export const PRODUCTION_PROVIDERS = {
  GEMINI: "gemini",
  MANUAL: "manual",
  REMOTION: "remotion",
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
  componentId: string;
  componentType: string;
  lessonId: string | null;
  materialLessonId: string | null;
  moduleId: string | null;
  organizationId: string | null;
}

export interface ProductionJobRecord {
  id: string;
  output_snapshot?: Record<string, unknown> | null;
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
}
