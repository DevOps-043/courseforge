import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const LOCAL_FUNCTIONS_BASE_URL = "http://localhost:8888";

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
  return getOptionalEnv("SUPABASE_SERVICE_ROLE_KEY") || getSupabaseAnonKey();
}

export function getGeminiApiKey() {
  return getOptionalGeminiApiKey() ||
    (() => {
      throw new Error(
        "Missing environment variable: GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY",
      );
    })();
}

export function getOptionalGeminiApiKey() {
  return (
    getOptionalEnv("GOOGLE_GENERATIVE_AI_API_KEY") ||
    getOptionalEnv("GOOGLE_API_KEY")
  );
}

export function getGeminiApiKeySource() {
  if (getOptionalEnv("GOOGLE_GENERATIVE_AI_API_KEY")) {
    return "GOOGLE_GENERATIVE_AI_API_KEY";
  }

  if (getOptionalEnv("GOOGLE_API_KEY")) {
    return "GOOGLE_API_KEY";
  }

  return "missing";
}

export function getSofliaInboxEnv() {
  return {
    key: getRequiredEnv("SOFLIA_INBOX_SUPABASE_KEY"),
    url: getRequiredEnv("SOFLIA_INBOX_SUPABASE_URL"),
  };
}

export function getCourseforgeJwtSecret() {
  return getRequiredEnv("COURSEFORGE_JWT_SECRET");
}

export function createServiceRoleClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceKey());
}

export function createGeminiClient() {
  return new GoogleGenAI({ apiKey: getGeminiApiKey() });
}

export function createGoogleAIProvider() {
  return createGoogleGenerativeAI({
    apiKey: getGeminiApiKey(),
  });
}

export function getFunctionsBaseUrl() {
  const candidate = getOptionalEnv("URL") || getOptionalEnv("DEPLOY_URL");
  if (!candidate) {
    return LOCAL_FUNCTIONS_BASE_URL;
  }

  return candidate.startsWith("http") ? candidate : `https://${candidate}`;
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
    model: data?.model_name || defaults.model,
    fallbackModel: data?.fallback_model || defaults.fallbackModel,
    temperature: data?.temperature ?? defaults.temperature,
    thinkingLevel: data?.thinking_level || defaults.thinkingLevel,
  };
}
