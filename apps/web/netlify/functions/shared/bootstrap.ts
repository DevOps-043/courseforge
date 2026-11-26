import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import { resolveBackgroundFunctionOrigin } from "../../../src/lib/server/background-function-origin";
import { resolveOpenAiTextModel, resolveOpenAiTextModels } from "../../../src/shared/ai/text-model-provider";

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string) {
  return process.env[name] || null;
}

export function getSupabaseUrl() {
  return getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey() {
  return getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function hasSupabaseServiceRoleKey() {
  return Boolean(getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export function getSupabaseServiceKey() {
  return getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getSofliaInboxEnv() {
  return {
    key: getRequiredEnv("SOFLIA_INBOX_SUPABASE_KEY"),
    url: getRequiredEnv("SOFLIA_INBOX_SUPABASE_URL"),
  };
}

export function getOpenAiApiKey() {
  return getRequiredEnv("OPENAI_API_KEY");
}

export function getOptionalOpenAiApiKey() {
  return getOptionalEnv("OPENAI_API_KEY");
}

export function getOptionalOpenAiAdminConfig() {
  return {
    adminKey: getOptionalEnv("OPENAI_ADMIN_KEY"),
    organizationId: getOptionalEnv("OPENAI_ORG_ID"),
    projectId: getOptionalEnv("OPENAI_PROJECT_ID"),
  };
}

export function getSofliaAuthSupabaseAnonKey() {
  return getRequiredEnv("SOFLIA_AUTH_SUPABASE_ANON_KEY");
}

export function getCourseforgeJwtSecret() {
  return getRequiredEnv("COURSEFORGE_JWT_SECRET");
}

export function createServiceRoleClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceKey());
}

export function createOpenAiClient() {
  return new OpenAI({ apiKey: getOpenAiApiKey() });
}

export function createOpenAiAIProvider() {
  return createOpenAI({
    apiKey: getOpenAiApiKey(),
  });
}

export function resolveAiModel(modelName: string) {
  return createOpenAiAIProvider().responses(resolveOpenAiTextModel(modelName));
}

export function getFunctionsBaseUrl() {
  return resolveBackgroundFunctionOrigin(process.env);
}

export interface ModelSettingResult {
  model: string;
  fallbackModel: string;
  temperature: number;
  thinkingLevel: string;
}

/**
 * Resuelve la configuración de modelo para un paso del pipeline desde model_settings.
 * Si no hay fila activa para el setting_type, usa los defaults provistos.
 * Patrón centralizado para todos los background jobs.
 */
export async function resolveModelSetting(
  supabase: ReturnType<typeof createServiceRoleClient>,
  settingType: string,
  defaults: ModelSettingResult,
  organizationId?: string | null,
): Promise<ModelSettingResult> {
  const selectActiveSetting = (orgId?: string | null) => {
    let query = supabase
      .from("model_settings")
      .select("model_name, fallback_model, temperature, thinking_level")
      .eq("setting_type", settingType)
      .eq("is_active", true)
      .order("id", { ascending: false })
      .limit(1);

    return orgId ? query.eq("organization_id", orgId) : query.is("organization_id", null);
  };

  const { data: orgData } = organizationId
    ? await selectActiveSetting(organizationId).maybeSingle()
    : { data: null };

  const { data: globalData } = await selectActiveSetting(null).maybeSingle();
  const data = orgData || globalData;

  return {
    ...resolveOpenAiTextModels(data?.model_name, data?.fallback_model, defaults),
    temperature: data?.temperature ?? defaults.temperature,
    thinkingLevel: data?.thinking_level || defaults.thinkingLevel,
  };
}

/**
 * Resolves a required database-backed model configuration.
 * Requiere una fila activa y convierte los modelos históricos a OpenAI.
 */
export async function resolveConfiguredModelSetting(
  supabase: ReturnType<typeof createServiceRoleClient>,
  settingType: string,
  organizationId?: string | null,
): Promise<ModelSettingResult> {
  const selectActiveSetting = async (orgId?: string | null) => {
    let query = supabase
      .from("model_settings")
      .select("model_name, fallback_model, temperature, thinking_level")
      .eq("setting_type", settingType)
      .eq("is_active", true)
      .order("id", { ascending: false })
      .limit(1);

    query = orgId
      ? query.eq("organization_id", orgId)
      : query.is("organization_id", null);

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(
        `No se pudo consultar la configuracion de modelo ${settingType}: ${error.message}`,
      );
    }
    return data;
  };

  const organizationSetting = organizationId
    ? await selectActiveSetting(organizationId)
    : null;
  const configuredSetting = organizationSetting || await selectActiveSetting(null);

  if (!configuredSetting?.model_name?.trim()) {
    throw new Error(
      `MODEL_SETTING_NOT_CONFIGURED: Configura un modelo principal activo para ${settingType} en Configuracion antes de ejecutar esta fase.`,
    );
  }

  return {
    ...resolveOpenAiTextModels(configuredSetting.model_name, configuredSetting.fallback_model),
    temperature: configuredSetting.temperature ?? 0.7,
    thinkingLevel: configuredSetting.thinking_level || "medium",
  };
}
