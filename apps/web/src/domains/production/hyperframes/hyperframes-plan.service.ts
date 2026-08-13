import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getOptionalGeminiApiKey } from "../../../lib/server/env";
import type { HyperframesCompositionMode } from "./hyperframes.types";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const hyperframesPlanSchema = z.object({
  accentColor: z.string().regex(HEX_COLOR),
  durationSeconds: z.number().int().min(3).max(120),
  subtitle: z.string().trim().min(1).max(220),
  title: z.string().trim().min(1).max(100),
}).strict();

export type HyperframesPlan = z.infer<typeof hyperframesPlanSchema>;

export interface HyperframesPlanResult {
  model: string | null;
  plan: HyperframesPlan;
  source: "agent" | "deterministic";
  warning: string | null;
}

/** The model proposes copy and style only; HTML is always compiled internally. */
export async function generateHyperframesPlan(params: {
  agentInstruction?: string;
  assetCount: number;
  mode: HyperframesCompositionMode;
  settings: {
    agentAssistedGenerationEnabled: boolean;
    agentModel: string;
    automaticGenerationEnabled: boolean;
    temperature: number;
  };
  title: string;
}): Promise<HyperframesPlanResult> {
  const fallback = buildDeterministicPlan({
    agentInstruction: params.agentInstruction,
    assetCount: params.assetCount,
    title: params.title,
  });
  if (params.mode === "AUTOMATIC") {
    if (!params.settings.automaticGenerationEnabled) {
      throw new Error("La generación automática de HyperFrames está deshabilitada para esta empresa.");
    }
    return { model: null, plan: fallback, source: "deterministic", warning: null };
  }
  if (!params.settings.agentAssistedGenerationEnabled) {
    throw new Error("La generación asistida por agente está deshabilitada para esta empresa.");
  }
  const apiKey = getOptionalGeminiApiKey();
  if (!apiKey) {
    return {
      model: null,
      plan: fallback,
      source: "deterministic",
      warning: "No hay credencial Gemini disponible; se generó una composición interna base.",
    };
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const result = await client.models.generateContent({
      model: params.settings.agentModel,
      contents: [
        {
          role: "user",
          parts: [{
            text: [
              "Diseña la copia para una composición de video educativa.",
              "Responde únicamente JSON con title, subtitle, accentColor y durationSeconds.",
              "No incluyas HTML, JavaScript, URLs ni Markdown.",
              `Título base: ${params.title}`,
              `Assets disponibles: ${params.assetCount}`,
              `Instrucción del editor: ${params.agentInstruction || "ninguna"}`,
            ].join("\n"),
          }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: params.settings.temperature,
      },
    });
    const plan = hyperframesPlanSchema.parse(JSON.parse(extractJson(result.text || "")));
    return { model: params.settings.agentModel, plan, source: "agent", warning: null };
  } catch {
    return {
      model: params.settings.agentModel,
      plan: fallback,
      source: "deterministic",
      warning: "El agente no produjo una especificación válida; se generó una composición interna base.",
    };
  }
}

export function buildDeterministicPlan(params: {
  agentInstruction?: string;
  assetCount: number;
  title: string;
}): HyperframesPlan {
  const cleanTitle = params.title.trim().slice(0, 100) || "Lección";
  const instruction = params.agentInstruction?.trim().replace(/\s+/g, " ").slice(0, 180);
  return {
    accentColor: "#38BDF8",
    durationSeconds: Math.min(30, Math.max(8, 6 + params.assetCount * 3)),
    subtitle: instruction || `Composición educativa creada con ${params.assetCount} asset${params.assetCount === 1 ? "" : "s"} existentes.`,
    title: cleanTitle,
  };
}

function extractJson(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("La respuesta del agente no contiene JSON.");
}
