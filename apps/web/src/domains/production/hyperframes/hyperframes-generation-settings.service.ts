import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const hyperframesGenerationSettingsSchema = z.object({
  agentAssistedGenerationEnabled: z.boolean().default(true),
  agentModel: z.string().trim().min(1).max(128),
  automaticGenerationEnabled: z.boolean().default(true),
  fallbackModel: z.string().trim().min(1).max(128).nullable().optional(),
  temperature: z.number().min(0).max(2).default(0.3),
}).strict();

export type HyperframesGenerationSettings = z.infer<typeof hyperframesGenerationSettingsSchema>;

export const DEFAULT_HYPERFRAMES_GENERATION_SETTINGS: HyperframesGenerationSettings = {
  agentAssistedGenerationEnabled: true,
  agentModel: "gemini-2.0-flash",
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
  return hyperframesGenerationSettingsSchema.parse({
    agentAssistedGenerationEnabled: row.agent_assisted_generation_enabled,
    agentModel: row.agent_model,
    automaticGenerationEnabled: row.automatic_generation_enabled,
    fallbackModel: row.fallback_model || null,
    temperature: Number(row.temperature),
  });
}
