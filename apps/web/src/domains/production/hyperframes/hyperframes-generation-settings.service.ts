import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { VIDEO_STUDIO_MODEL_IDS } from "./video-studio-model-options";

export const hyperframesGenerationSettingsSchema = z.object({
  agentAssistedGenerationEnabled: z.boolean().default(true),
  agentModel: z.enum(VIDEO_STUDIO_MODEL_IDS),
  automaticGenerationEnabled: z.boolean().default(true),
  fallbackModel: z.enum(VIDEO_STUDIO_MODEL_IDS).nullable().default(null),
  temperature: z.number().min(0).max(2).default(0.3),
}).strict().superRefine((settings, context) => {
  if (settings.fallbackModel === settings.agentModel) {
    context.addIssue({
      code: "custom",
      message: "El modelo de respaldo debe ser distinto del modelo principal.",
      path: ["fallbackModel"],
    });
  }
});

export type HyperframesGenerationSettings = z.infer<typeof hyperframesGenerationSettingsSchema>;

export const DEFAULT_HYPERFRAMES_GENERATION_SETTINGS: HyperframesGenerationSettings = {
  agentAssistedGenerationEnabled: true,
  agentModel: "gemini-3.5-flash",
  automaticGenerationEnabled: true,
  fallbackModel: null,
  temperature: 0.3,
};

export async function getHyperframesGenerationSettings(params: {
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_composition_generation_settings")
    .select("agent_model, fallback_model, temperature, automatic_generation_enabled, agent_assisted_generation_enabled")
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_HYPERFRAMES_GENERATION_SETTINGS;
  return mapSettingsRow(data);
}

export async function saveHyperframesGenerationSettings(params: {
  organizationId: string;
  settings: HyperframesGenerationSettings;
  supabase: SupabaseClient<any, "public", any>;
  updatedBy: string;
}) {
  const now = new Date().toISOString();
  const { data, error } = await params.supabase
    .from("video_composition_generation_settings")
    .upsert({
      agent_assisted_generation_enabled: params.settings.agentAssistedGenerationEnabled,
      agent_model: params.settings.agentModel,
      automatic_generation_enabled: params.settings.automaticGenerationEnabled,
      fallback_model: params.settings.fallbackModel || null,
      organization_id: params.organizationId,
      temperature: params.settings.temperature,
      updated_at: now,
      updated_by: params.updatedBy,
    }, { onConflict: "organization_id" })
    .select("agent_model, fallback_model, temperature, automatic_generation_enabled, agent_assisted_generation_enabled")
    .single();
  if (error) throw error;
  return mapSettingsRow(data);
}

function mapSettingsRow(row: Record<string, unknown>): HyperframesGenerationSettings {
  const agentModel = typeof row.agent_model === "string" && VIDEO_STUDIO_MODEL_IDS.includes(row.agent_model as typeof VIDEO_STUDIO_MODEL_IDS[number])
    ? row.agent_model
    : DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.agentModel;
  const fallbackModel = typeof row.fallback_model === "string"
    && row.fallback_model !== agentModel
    && VIDEO_STUDIO_MODEL_IDS.includes(row.fallback_model as typeof VIDEO_STUDIO_MODEL_IDS[number])
    ? row.fallback_model
    : null;
  return hyperframesGenerationSettingsSchema.parse({
    agentAssistedGenerationEnabled: row.agent_assisted_generation_enabled,
    agentModel,
    automaticGenerationEnabled: row.automatic_generation_enabled,
    fallbackModel,
    temperature: Number(row.temperature),
  });
}
