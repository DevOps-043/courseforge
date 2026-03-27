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

export function getSupabaseUrl() {
  return getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}

export function getGeminiApiKey() {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    (() => {
      throw new Error(
        "Missing environment variable: GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY",
      );
    })()
  );
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
  const candidate = process.env.URL || process.env.DEPLOY_URL;
  if (!candidate) {
    return LOCAL_FUNCTIONS_BASE_URL;
  }

  return candidate.startsWith("http") ? candidate : `https://${candidate}`;
}
