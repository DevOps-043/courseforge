import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";

import { COURSE_TEXT_MODELS, resolveOpenAiTextModels } from "../../shared/ai/text-model-provider";

export type PipelineModelSettingType =
  | "ARTIFACT_BASE"
  | "SYLLABUS"
  | "INSTRUCTIONAL_PLAN"
  | "CURATION"
  | "MATERIALS"
  | "BUNDLE_AGENT"
  | "SLIDES_DECK_BRIEF_AGENT"
  | "SLIDES_EVIDENCE_AGENT"
  | "SLIDES_STRATEGY_AGENT"
  | "SLIDE_TEMPLATE_TYPE_AGENT"
  | "SLIDES_VISIBLE_COPY_AGENT"
  | "SLIDES_VISUAL_TEMPLATE_AGENT"
  | "SLIDES_QA_AGENT"
  | "SLIDES_IMAGE_GENERATION";

export interface PipelineModelSettings {
  fallback_model: string | null;
  model_name: string;
  setting_type: PipelineModelSettingType;
  temperature: number;
  thinking_level: string | null;
}

interface ModelSettingsRecord {
  fallback_model?: string | null;
  model_name?: string | null;
  temperature?: number | string | null;
  thinking_level?: string | null;
}

const DEFAULT_MODEL_SETTINGS: Record<PipelineModelSettingType, PipelineModelSettings> = {
  ARTIFACT_BASE: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "ARTIFACT_BASE",
    temperature: 0.7,
    thinking_level: "medium",
  },
  SYLLABUS: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SYLLABUS",
    temperature: 0.7,
    thinking_level: "medium",
  },
  INSTRUCTIONAL_PLAN: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "INSTRUCTIONAL_PLAN",
    temperature: 0.7,
    thinking_level: "medium",
  },
  CURATION: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "CURATION",
    temperature: 0.1,
    thinking_level: "low",
  },
  MATERIALS: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "MATERIALS",
    temperature: 0.7,
    thinking_level: "minimal",
  },
  BUNDLE_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "BUNDLE_AGENT",
    temperature: 0.3,
    thinking_level: "medium",
  },
  SLIDES_DECK_BRIEF_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDES_DECK_BRIEF_AGENT",
    temperature: 0.2,
    thinking_level: "low",
  },
  SLIDES_EVIDENCE_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDES_EVIDENCE_AGENT",
    temperature: 0.1,
    thinking_level: "low",
  },
  SLIDES_STRATEGY_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDES_STRATEGY_AGENT",
    temperature: 0.3,
    thinking_level: "medium",
  },
  SLIDE_TEMPLATE_TYPE_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDE_TEMPLATE_TYPE_AGENT",
    temperature: 0.45,
    thinking_level: "medium",
  },
  SLIDES_VISIBLE_COPY_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDES_VISIBLE_COPY_AGENT",
    temperature: 0.3,
    thinking_level: "low",
  },
  SLIDES_VISUAL_TEMPLATE_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDES_VISUAL_TEMPLATE_AGENT",
    temperature: 0.5,
    thinking_level: "medium",
  },
  SLIDES_QA_AGENT: {
    fallback_model: COURSE_TEXT_MODELS.fallbackModel,
    model_name: COURSE_TEXT_MODELS.model,
    setting_type: "SLIDES_QA_AGENT",
    temperature: 0.1,
    thinking_level: "low",
  },
  SLIDES_IMAGE_GENERATION: {
    fallback_model: "gpt-image-2",
    model_name: "gpt-image-2",
    setting_type: "SLIDES_IMAGE_GENERATION",
    temperature: 0,
    thinking_level: "minimal",
  },
};

function openAiImageModel<T extends string | null>(model: string | null | undefined, fallback: T) {
  return model && /^gpt-image-/i.test(model) ? model : fallback;
}

const MODEL_SETTINGS_SELECT_FIELDS =
  "model_name, fallback_model, temperature, thinking_level";

function getAdminClient() {
  return createAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
}

function parseTemperature(value: ModelSettingsRecord["temperature"], fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeSettings(
  settingType: PipelineModelSettingType,
  record?: ModelSettingsRecord | null,
): PipelineModelSettings {
  const defaults = DEFAULT_MODEL_SETTINGS[settingType];

  const models = settingType === "SLIDES_IMAGE_GENERATION"
    ? { model: openAiImageModel(record?.model_name, defaults.model_name), fallbackModel: openAiImageModel(record?.fallback_model, defaults.fallback_model) }
    : resolveOpenAiTextModels(record?.model_name, record?.fallback_model);
  return {
    fallback_model: models.fallbackModel,
    model_name: models.model,
    setting_type: settingType,
    temperature: parseTemperature(record?.temperature, defaults.temperature),
    thinking_level: record?.thinking_level || defaults.thinking_level,
  };
}

async function findActiveSetting(
  settingType: PipelineModelSettingType,
  organizationId?: string | null,
) {
  const admin = getAdminClient();
  let query = admin
    .from("model_settings")
    .select(MODEL_SETTINGS_SELECT_FIELDS)
    .eq("setting_type", settingType)
    .eq("is_active", true)
    .order("id", { ascending: false })
    .limit(1);

  query = organizationId
    ? query.eq("organization_id", organizationId)
    : query.is("organization_id", null);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.warn(
      `[ModelSettings] Could not load ${settingType} settings for ${organizationId || "global"}:`,
      error.message,
    );
    return null;
  }

  return data as ModelSettingsRecord | null;
}

export async function getPipelineModelSettings(
  settingType: PipelineModelSettingType,
  organizationId?: string | null,
) {
  const orgSetting = organizationId
    ? await findActiveSetting(settingType, organizationId)
    : null;

  if (orgSetting) {
    return normalizeSettings(settingType, orgSetting);
  }

  const globalSetting = await findActiveSetting(settingType, null);
  return normalizeSettings(settingType, globalSetting);
}
