import type OpenAI from "openai";
import { isOpenAiReasoningModel, resolveOpenAiTextModel } from "../../../shared/ai/text-model-provider";
import { extractOpenAiSearchQueries, extractOpenAiWebSources } from "../../../shared/ai/openai-web-search";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordAiFailure,
  recordOpenAiUsage,
  type AiUsageContext,
} from "../../../shared/ai/usage-telemetry";

export interface SyllabusModelClients {
  openai: OpenAI;
}

export interface SyllabusResearchResult {
  groundingMetadata: {
    provider: "openai";
    response_id: string;
    citations: ReturnType<typeof extractOpenAiWebSources>;
  };
  searchQueries: string[];
  text: string;
}

interface SyllabusTelemetry {
  context: AiUsageContext;
  supabase?: SupabaseClient | null;
}

export async function generateSyllabusResearch(params: {
  clients: SyllabusModelClients;
  model: string;
  prompt: string;
  temperature: number;
  telemetry?: SyllabusTelemetry;
}): Promise<SyllabusResearchResult> {
  const { clients, prompt, telemetry } = params;
  const model = resolveOpenAiTextModel(params.model);

  const startedAt = Date.now();
  let response;
  try {
    response = await clients.openai.responses.create({
      model,
      input: prompt,
      ...(!isOpenAiReasoningModel(model) ? { temperature: params.temperature } : {}),
      max_output_tokens: 5000,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      store: false,
    });
  } catch (error) {
    if (telemetry) await recordAiFailure({ ...telemetry, error, model, provider: "openai", startedAt });
    throw error;
  }
  if (telemetry) await recordOpenAiUsage({ ...telemetry, model, response, startedAt });

  return {
    text: response.output_text || "",
    searchQueries: extractOpenAiSearchQueries(response.output),
    groundingMetadata: {
      provider: "openai",
      response_id: response.id,
      citations: extractOpenAiWebSources(response.output),
    },
  };
}

export async function generateSyllabusJson(params: {
  clients: SyllabusModelClients;
  model: string;
  prompt: string;
  temperature: number;
  telemetry?: SyllabusTelemetry;
}) {
  const { clients, prompt, telemetry } = params;
  const model = resolveOpenAiTextModel(params.model);

  const startedAt = Date.now();
  let response;
  try {
    response = await clients.openai.responses.create({
      model,
      input: prompt,
      ...(!isOpenAiReasoningModel(model) ? { temperature: params.temperature } : {}),
      max_output_tokens: 16000,
      text: { format: { type: "json_object" } },
      store: false,
    });
  } catch (error) {
    if (telemetry) await recordAiFailure({ ...telemetry, error, model, provider: "openai", startedAt });
    throw error;
  }
  if (telemetry) await recordOpenAiUsage({ ...telemetry, model, response, startedAt });

  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason === "max_output_tokens"
  ) {
    throw new Error(
      `TRUNCATED_SYLLABUS_RESPONSE: ${model} alcanzo el limite de salida antes de completar el JSON.`,
    );
  }

  return response.output_text || "";
}
