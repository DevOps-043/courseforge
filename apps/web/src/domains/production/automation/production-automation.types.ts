import type { ComponentType, MaterialAssets, StoryboardItem } from "@/domains/materials/types/materials.types";

export const PRODUCTION_RUN_STATUSES = [
  "PLANNING",
  "GENERATING",
  "PARTIALLY_READY",
  "READY_FOR_ASSEMBLY",
  "NEEDS_ATTENTION",
  "CANCELLED",
] as const;

export const PRODUCTION_RUN_ITEM_STATUSES = [
  "PLANNED",
  "QUEUED",
  "GENERATING",
  "WAITING_PROVIDER",
  "READY_FOR_ASSEMBLY",
  "IN_ASSEMBLY",
  "STALE",
  "FAILED_RETRYABLE",
  "FAILED",
  "SKIPPED",
] as const;

export const PRODUCTION_ASSET_REQUIREMENT_KINDS = [
  "AVATAR_AND_VOICE",
  "SLIDES",
  "BROLL",
  "SCREENCAST",
] as const;

export type ProductionRunStatus = (typeof PRODUCTION_RUN_STATUSES)[number];
export type ProductionRunItemStatus = (typeof PRODUCTION_RUN_ITEM_STATUSES)[number];
export type ProductionAssetRequirementKind = (typeof PRODUCTION_ASSET_REQUIREMENT_KINDS)[number];

export interface ProductionAssetRequirement {
  kind: ProductionAssetRequirementKind;
  reason: string;
}

export interface ProductionAvatarConfiguration {
  aspectRatio: "16:9" | "9:16";
  avatarPresetId: string;
  caption: boolean;
  engine: "avatar_iv" | "avatar_v";
  generationMode: "scene_clips" | "single_video";
  outputFormat: "mp4" | "webm";
  resolution: "720p" | "1080p" | "4k";
  /** Explicit voice selection. The provider must never silently choose one. */
  voicePresetId: string;
}

export interface ProductionSlidesConfiguration {
  generateVisuals: boolean;
  locale: "es" | "en";
  slideTemplateRunId?: string;
  template: "concept-lesson" | "course-module" | "data-explainer" | "demo-guide";
}

export interface ProductionRunItemConfiguration {
  avatar?: ProductionAvatarConfiguration;
  slides?: ProductionSlidesConfiguration;
}

/**
 * Defaults are intentionally stored at run level, while item configuration is
 * an override. This gives the reviewer a course-wide profile without taking
 * away per-lesson control.
 */
export interface ProductionRunConfiguration {
  approval_state?: "DRAFT" | "APPROVED";
  defaults?: ProductionRunItemConfiguration;
  render_mode?: "MANUAL_ONLY";
  version?: number;
}

export interface ProductionItemReadiness {
  complete: boolean;
  evaluatedAt: string;
  requirements: Array<ProductionAssetRequirement & { complete: boolean; detail?: string }>;
}

export interface ProductionAutomationComponent {
  assets: MaterialAssets | null;
  componentType: ComponentType;
  content: { storyboard?: StoryboardItem[] } | null;
  id: string;
  lessonOrder: number;
  lessonId: string;
  materialLessonId: string;
  moduleId: string | null;
  moduleOrder: number;
}
