import { z } from "zod";
import type { ProductionRunConfiguration, ProductionRunItemConfiguration } from "./production-automation.types";

export function nativeCaptionsEnabledForItem(run: ProductionRunConfiguration | null, item: ProductionRunItemConfiguration | null) {
  return run?.approval_state === "APPROVED" && (item?.nativeCaptions ?? run.defaults?.nativeCaptions) === true;
}

const avatarSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16"]),
  avatarPresetId: z.string().uuid(),
  caption: z.boolean(),
  engine: z.enum(["avatar_iv", "avatar_v"]),
  generationMode: z.enum(["scene_clips", "single_video"]),
  outputFormat: z.enum(["mp4", "webm"]),
  resolution: z.enum(["720p", "1080p", "4k"]),
  voicePresetId: z.string().uuid(),
}).strict();

const slidesSchema = z.object({
  appearance: z.enum(["light", "dark"]).default("light"),
  generateVisuals: z.boolean(),
  locale: z.enum(["es", "en"]),
  slideTemplateRunId: z.string().uuid().optional(),
  template: z.enum(["concept-lesson", "course-module", "data-explainer", "demo-guide"]),
}).strict();

const itemConfigurationSchema = z.object({
  avatar: avatarSchema.optional(),
  nativeCaptions: z.boolean().optional(),
  slides: slidesSchema.optional(),
}).strict();

export const productionAutomationConfigurationSchema = z.object({
  approve: z.boolean().default(false),
  defaults: itemConfigurationSchema.optional(),
  items: z.array(z.object({
    componentId: z.string().uuid(),
  }).merge(itemConfigurationSchema).strict()).default([]),
}).strict();
