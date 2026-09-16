import type { GoogleGenAI } from "@google/genai";
import type OpenAI from "openai";
import { ModelJsonResponseError, parseModelJsonResponse } from "../../../src/shared/ai/model-json-response";
import { getMaterialsModelProvider } from "../../../src/shared/ai/materials-model-provider";
import { VIDEO_GENERATION_LIMITS, VideoModelResponseError, type VideoModelRequest, type VideoModelResponse } from "../../../src/domains/materials/generation/video-generation.contracts";
import { createGeminiClient, createOpenAiClient } from "./bootstrap";

export interface MaterialsModelRuntimeConfig {
  temperature: number;
  thinkingLevel: string;
}

export function createMaterialsModelRequest(runtime: MaterialsModelRuntimeConfig): VideoModelRequest {
  let gemini: GoogleGenAI | undefined;
  let openai: OpenAI | undefined;
  return async ({ model, prompt, timeoutMs }) => {
    const provider = getMaterialsModelProvider(model);
    if (provider === "gemini") return requestGeminiJson(gemini ||= createGeminiClient(), model, prompt, runtime, timeoutMs);
    if (provider === "openai") return requestOpenAiJson(openai ||= createOpenAiClient(), model, prompt, runtime, timeoutMs);
    throw new Error("UNSUPPORTED_MATERIALS_MODEL: El modelo configurado no tiene proveedor implementado.");
  };
}

export async function requestGeminiJson(
  client: GoogleGenAI,
  model: string,
  prompt: string,
  runtime: MaterialsModelRuntimeConfig,
  timeoutMs: number = VIDEO_GENERATION_LIMITS.requestTimeoutMs,
): Promise<VideoModelResponse> {
  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: runtime.temperature,
      maxOutputTokens: VIDEO_GENERATION_LIMITS.maximumOutputTokens,
      responseMimeType: "application/json",
      abortSignal: AbortSignal.timeout(timeoutMs),
      httpOptions: { timeout: timeoutMs },
    },
  });
  const finishReason = response.candidates?.[0]?.finishReason;
  return parseResponse(response.text, finishReason, response.usageMetadata?.candidatesTokenCount);
}

export async function requestOpenAiJson(
  client: OpenAI,
  model: string,
  prompt: string,
  runtime: MaterialsModelRuntimeConfig,
  timeoutMs: number = VIDEO_GENERATION_LIMITS.requestTimeoutMs,
): Promise<VideoModelResponse> {
  const response = await client.responses.create({
    model,
    input: prompt,
    max_output_tokens: VIDEO_GENERATION_LIMITS.maximumOutputTokens,
    reasoning: { effort: normalizeReasoningEffort(runtime.thinkingLevel) },
    text: { format: { type: "json_object" } },
  }, { timeout: timeoutMs, maxRetries: 0, signal: AbortSignal.timeout(timeoutMs) });
  const finishReason = response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens"
    ? "MAX_TOKENS" : response.status;
  return parseResponse(response.output_text, finishReason, response.usage?.output_tokens);
}

function parseResponse(responseText?: string, finishReason?: string | null, outputTokens?: number): VideoModelResponse {
  try {
    return { content: parseModelJsonResponse({ responseText, finishReason }), finishReason, outputTokens };
  } catch (error) {
    if (error instanceof ModelJsonResponseError) throw new VideoModelResponseError(error.code, finishReason, outputTokens);
    throw error;
  }
}

function normalizeReasoningEffort(value: string): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  switch (value.trim().toLowerCase()) {
    case "none": return "none";
    case "minimal": return "minimal";
    case "low": return "low";
    case "high": return "high";
    case "xhigh": return "xhigh";
    default: return "medium";
  }
}
