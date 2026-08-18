import { GoogleGenAI } from "@google/genai";
import { isVideoStudioReasoningModel } from "../hyperframes/video-studio-model-options";
import {
  getCompositionAgentProviderJsonSchema,
  normalizeCompactCompositionAgentModelOutput,
} from "./composition-agent-model-output.types";

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

export class CompositionAgentProviderError extends Error {
  constructor(
    message: string,
    readonly code: "PROVIDER_INVALID_JSON" | "PROVIDER_INVALID_OUTPUT" | "PROVIDER_REQUEST_FAILED",
    readonly provider: "gemini" | "openai",
    readonly providerStatus: number | null = null,
  ) {
    super(message);
  }
}

export function buildOpenAiCompositionProposalRequest(params: { model: string; prompt: string; temperature: number }) {
  const request: Record<string, unknown> = {
    input: params.prompt,
    model: params.model,
    text: {
      format: {
        name: "composition_edit_proposal",
        schema: getCompositionAgentProviderJsonSchema(),
        strict: true,
        type: "json_schema",
      },
    },
  };
  if (!isVideoStudioReasoningModel(params.model)) request.temperature = params.temperature;
  return request;
}

export function buildGeminiCompositionProposalConfig(temperature: number) {
  return {
    responseJsonSchema: getCompositionAgentProviderJsonSchema(),
    responseMimeType: "application/json",
    temperature,
  };
}

export async function requestCompositionAgentPatch(params: {
  apiKey: string;
  model: string;
  prompt: string;
  provider: "gemini" | "openai";
  temperature: number;
  timeoutMs?: number;
}) {
  let text: string;
  try {
    text = params.provider === "gemini"
      ? await requestGeminiProposal(params)
      : await requestOpenAiProposal(params);
  } catch (error) {
    if (error instanceof CompositionAgentProviderError) throw error;
    throw new CompositionAgentProviderError(
      "El proveedor no pudo generar la propuesta.",
      "PROVIDER_REQUEST_FAILED",
      params.provider,
      readProviderStatus(error),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CompositionAgentProviderError("El proveedor devolvió JSON inválido.", "PROVIDER_INVALID_JSON", params.provider);
  }
  try {
    return normalizeCompactCompositionAgentModelOutput(parsed);
  } catch {
    throw new CompositionAgentProviderError("La salida no cumple el contrato de edición.", "PROVIDER_INVALID_OUTPUT", params.provider);
  }
}

async function requestGeminiProposal(params: { apiKey: string; model: string; prompt: string; temperature: number; timeoutMs?: number }) {
  const client = new GoogleGenAI({ apiKey: params.apiKey });
  const result = await client.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: encodeCompositionAgentPrompt(params.prompt) }] }],
    config: {
      ...buildGeminiCompositionProposalConfig(params.temperature),
      abortSignal: AbortSignal.timeout(providerTimeout(params.timeoutMs)),
    },
  });
  if (!result.text) throw new CompositionAgentProviderError("Gemini no devolvió contenido.", "PROVIDER_INVALID_OUTPUT", "gemini");
  return result.text;
}

async function requestOpenAiProposal(params: { apiKey: string; model: string; prompt: string; temperature: number; timeoutMs?: number }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildOpenAiCompositionProposalRequest({ ...params, prompt: encodeCompositionAgentPrompt(params.prompt) })),
    signal: AbortSignal.timeout(providerTimeout(params.timeoutMs)),
  });
  if (!response.ok) throw new CompositionAgentProviderError("OpenAI rechazó la solicitud.", "PROVIDER_REQUEST_FAILED", "openai", response.status);
  const payload = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown; type?: unknown }> }> };
  if (typeof payload.output_text === "string") return payload.output_text;
  const text = payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text" && typeof item.text === "string")?.text;
  if (typeof text !== "string") throw new CompositionAgentProviderError("OpenAI no devolvió contenido.", "PROVIDER_INVALID_OUTPUT", "openai");
  return text;
}

function encodeCompositionAgentPrompt(prompt: string) {
  return `${prompt}\nPROVIDER_OUTPUT_ENCODING: Cada operación debe tener exactamente {type, argumentsJson}. argumentsJson es un string que contiene un objeto JSON válido con los campos de la operación excepto type. Ejemplo: {\"type\":\"clip.visibility\",\"argumentsJson\":\"{\\\"clipId\\\":\\\"visual-clip\\\",\\\"hidden\\\":true}\"}.`;
}

function providerTimeout(timeoutMs: number | undefined) {
  if (timeoutMs === undefined) return DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.max(1_000, Math.min(DEFAULT_PROVIDER_TIMEOUT_MS, Math.floor(timeoutMs)));
}

function readProviderStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; name?: unknown };
  if (candidate.name === "TimeoutError" || /timed?\s*out/i.test(String(candidate.message || ""))) return 408;
  for (const value of [candidate.status, candidate.statusCode, candidate.code]) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 400 && numeric <= 599) return numeric;
  }
  const match = String(candidate.message || "").match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
}
