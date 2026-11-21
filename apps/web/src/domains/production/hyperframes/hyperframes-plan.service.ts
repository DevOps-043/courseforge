import OpenAI from "openai";
import { resolveOpenAiTextModels, withTextModelFallback } from "../../../shared/ai/text-model-provider";
import {hyperframesPlanSchema, type HyperframesPlan} from "./hyperframes-plan.types";
import { getOptionalOpenAIApiKey } from "../../../lib/server/env";
import type { HyperframesCompositionMode } from "./hyperframes.types";

// Preserve the existing service API; consumers of the contract need no AI SDK.
export {hyperframesPlanSchema, type HyperframesPlan} from "./hyperframes-plan.types";

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
    fallbackModel?: string | null;
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
  const apiKey = getOptionalOpenAIApiKey();
  if (!apiKey) {
    return {
      model: null,
      plan: fallback,
      source: "deterministic",
      warning: "No hay credencial de OpenAI disponible; se generó una composición interna base.",
    };
  }

  const { model, fallbackModel } = resolveOpenAiTextModels(params.settings.agentModel, params.settings.fallbackModel);
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  try {
    return await withTextModelFallback(model, fallbackModel, async selectedModel => {
      const result = await client.responses.create({
        model: selectedModel, store: false, max_output_tokens: 1500,
        instructions: "Redacta el contenido de una composición educativa. Devuelve JSON con title, subtitle, accentColor y durationSeconds. No incluyas HTML, JavaScript, URLs ni Markdown.",
        input: JSON.stringify({ title: params.title, assetCount: params.assetCount, instruction: params.agentInstruction }),
        text: { format: { type: "json_object" } },
      });
      const plan = hyperframesPlanSchema.parse(JSON.parse(result.output_text));
      return { model: selectedModel, plan, source: "agent", warning: null };
    });
  } catch {
    return {
      model,
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
