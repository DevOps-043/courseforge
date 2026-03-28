import { z } from "zod";

const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SOFLIA_INBOX_SUPABASE_URL: z.string().min(1).optional(),
    SOFLIA_INBOX_SUPABASE_KEY: z.string().min(1).optional(),
    SOFLIA_API_URL: z.string().min(1).optional(),
    SOFLIA_API_KEY: z.string().min(1).optional(),
    COURSEFORGE_JWT_SECRET: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    GOOGLE_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).optional(),
    GEMINI_SEARCH_MODEL: z.string().min(1).optional(),
    GEMINI_TEMPERATURE: z.string().min(1).optional(),
    GPT_SOURCES_API_KEY: z.string().min(1).optional(),
    NETLIFY: z.string().min(1).optional(),
    URL: z.string().min(1).optional(),
    DEPLOY_URL: z.string().min(1).optional(),
    NEXT_PUBLIC_APP_URL: z.string().min(1).optional(),
    NODE_ENV: z.string().min(1).optional(),
  })
  .passthrough();

type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

function buildEnvObject(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SOFLIA_INBOX_SUPABASE_URL: process.env.SOFLIA_INBOX_SUPABASE_URL,
    SOFLIA_INBOX_SUPABASE_KEY: process.env.SOFLIA_INBOX_SUPABASE_KEY,
    SOFLIA_API_URL: process.env.SOFLIA_API_URL,
    SOFLIA_API_KEY: process.env.SOFLIA_API_KEY,
    COURSEFORGE_JWT_SECRET: process.env.COURSEFORGE_JWT_SECRET,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_SEARCH_MODEL: process.env.GEMINI_SEARCH_MODEL,
    GEMINI_TEMPERATURE: process.env.GEMINI_TEMPERATURE,
    GPT_SOURCES_API_KEY: process.env.GPT_SOURCES_API_KEY,
    NETLIFY: process.env.NETLIFY,
    URL: process.env.URL,
    DEPLOY_URL: process.env.DEPLOY_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
}

function getParsedServerEnv() {
  if (cachedServerEnv) {
    return cachedServerEnv;
  }

  cachedServerEnv = serverEnvSchema.parse(buildEnvObject());
  return cachedServerEnv;
}

export function getSupabaseUrl() {
  return getParsedServerEnv().NEXT_PUBLIC_SUPABASE_URL;
}

export function getOptionalServerEnvValue<Key extends keyof ServerEnv>(key: Key) {
  return getParsedServerEnv()[key] ?? null;
}

export function getSupabaseServiceRoleKey() {
  const env = getParsedServerEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) {
    throw new Error(
      "Missing environment variable: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return key;
}

export function getSupabaseAnonKey() {
  const env = getParsedServerEnv();

  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function getSofliaInboxEnv() {
  const env = getParsedServerEnv();

  if (!env.SOFLIA_INBOX_SUPABASE_URL || !env.SOFLIA_INBOX_SUPABASE_KEY) {
    throw new Error(
      "Configuracion incompleta: faltan SOFLIA_INBOX_SUPABASE_URL o SOFLIA_INBOX_SUPABASE_KEY",
    );
  }

  return {
    url: env.SOFLIA_INBOX_SUPABASE_URL,
    key: env.SOFLIA_INBOX_SUPABASE_KEY,
  };
}

export function getCourseforgeJwtSecret() {
  const env = getParsedServerEnv();

  if (!env.COURSEFORGE_JWT_SECRET) {
    throw new Error(
      "Configuracion incompleta: falta COURSEFORGE_JWT_SECRET",
    );
  }

  return env.COURSEFORGE_JWT_SECRET;
}

export function getGeminiApiKey() {
  const env = getParsedServerEnv();
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Configuracion incompleta: falta GOOGLE_GENERATIVE_AI_API_KEY o GOOGLE_API_KEY",
    );
  }

  return apiKey;
}

export function getOptionalGeminiApiKey() {
  const env = getParsedServerEnv();
  return env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY || null;
}

export function getGeminiModel() {
  const env = getParsedServerEnv();

  if (!env.GEMINI_MODEL) {
    throw new Error("Configuracion incompleta: falta GEMINI_MODEL");
  }

  return env.GEMINI_MODEL;
}

export function getGeminiSearchModel(defaultModel = "gemini-2.0-flash") {
  return getParsedServerEnv().GEMINI_SEARCH_MODEL || defaultModel;
}

export function getGeminiTemperature(defaultTemperature = 0.7) {
  const rawValue = getParsedServerEnv().GEMINI_TEMPERATURE;

  if (!rawValue) {
    return defaultTemperature;
  }

  const parsedValue = Number.parseFloat(rawValue);
  return Number.isNaN(parsedValue) ? defaultTemperature : parsedValue;
}

export function getGptSourcesApiKey() {
  const env = getParsedServerEnv();

  if (!env.GPT_SOURCES_API_KEY) {
    throw new Error("Configuracion incompleta: falta GPT_SOURCES_API_KEY");
  }

  return env.GPT_SOURCES_API_KEY;
}

export function isNetlifyDeployment() {
  const env = getParsedServerEnv();
  return env.NETLIFY === "true" || env.NODE_ENV === "production";
}

export function isProductionEnvironment() {
  return getParsedServerEnv().NODE_ENV === "production";
}

export function getDeploymentSiteUrl(
  fallback = "https://cursos-nocode-v1.netlify.app",
) {
  const env = getParsedServerEnv();
  return env.URL || env.DEPLOY_URL || fallback;
}

export function getAppUrl() {
  return getParsedServerEnv().NEXT_PUBLIC_APP_URL || null;
}
