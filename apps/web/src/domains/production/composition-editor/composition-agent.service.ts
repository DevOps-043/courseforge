import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "@/lib/server/env";
import { getHyperframesGenerationSettings } from "../hyperframes/hyperframes-generation-settings.service";
import { getVideoStudioModelProvider, isVideoStudioReasoningModel } from "../hyperframes/video-studio-model-options";
import type { CompositionEditorDocument } from "./composition-document.types";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import { compositionEditorPatchRequestSchema } from "./editor-patch.types";
import {
  buildCompositionAgentContext,
  buildCompositionProposalPrompt,
} from "./composition-agent-prompt.service";

export class CompositionAgentProposalError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const proposalInputSchema = z.object({
  instruction: z.string().trim().min(3).max(1_500),
  selectedClipId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i).nullable().optional(),
}).strict();

export type CompositionAgentProposalInput = z.infer<typeof proposalInputSchema>;

/** Generates a constrained proposal; persistence always remains a separate approval action. */
export async function proposeCompositionEdits(params: {
  document: CompositionEditorDocument;
  input: unknown;
  organizationId: string;
  supabase: Parameters<typeof getHyperframesGenerationSettings>[0]["supabase"];
}) {
  const input = proposalInputSchema.parse(params.input);
  const settings = await getHyperframesGenerationSettings({
    organizationId: params.organizationId,
    supabase: params.supabase,
  });
  if (!settings.agentAssistedGenerationEnabled) {
    throw new CompositionAgentProposalError("La edici\u00f3n asistida est\u00e1 deshabilitada para esta empresa.", 409);
  }
  const provider = getVideoStudioModelProvider(settings.agentModel);
  if (!provider) {
    throw new CompositionAgentProposalError("El modelo de edición configurado no es compatible.", 400);
  }
  const apiKey = provider === "gemini" ? getOptionalGeminiApiKey() : getOptionalOpenAIApiKey();
  if (!apiKey) {
    throw new CompositionAgentProposalError(`No hay una API key configurada para ${provider === "openai" ? "OpenAI" : "Gemini"}.`, 503);
  }

  const selected = input.selectedClipId
    ? params.document.clips.find((clip) => clip.id === input.selectedClipId) || null
    : null;
  const context = buildCompositionAgentContext(params.document);
  try {
    const prompt = buildCompositionProposalPrompt({
      context,
      instruction: input.instruction,
      selectedClipId: selected?.id || null,
    });
    const raw = JSON.parse(extractJson(provider === "gemini"
      ? await requestGeminiProposal({ apiKey, model: settings.agentModel, prompt, temperature: settings.temperature })
      : await requestOpenAiProposal({ apiKey, model: settings.agentModel, prompt, temperature: settings.temperature })));
    const proposal = compositionEditorPatchRequestSchema.parse({ ...raw, source: "AGENT" });
    // Apply once on the server now, so an invalid proposal cannot reach the approval UI.
    applyCompositionEditorPatches(params.document, proposal.operations);
    return { ...proposal, model: settings.agentModel };
  } catch (error) {
    if (error instanceof CompositionAgentProposalError || error instanceof z.ZodError) throw error;
    throw new CompositionAgentProposalError("El agente no produjo una propuesta de edici\u00f3n v\u00e1lida. Puedes ajustar la instrucci\u00f3n y reintentar.", 422);
  }
}

async function requestGeminiProposal(params: { apiKey: string; model: string; prompt: string; temperature: number }) {
  const client = new GoogleGenAI({ apiKey: params.apiKey });
  const result = await client.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    config: { responseMimeType: "application/json", temperature: params.temperature },
  });
  return result.text || "";
}

async function requestOpenAiProposal(params: { apiKey: string; model: string; prompt: string; temperature: number }) {
  const request: Record<string, unknown> = {
    input: params.prompt,
    model: params.model,
    text: { format: { type: "json_object" } },
  };
  // Reasoning models do not all accept temperature. Keeping it out makes every
  // model shown in Settings usable with the same proposal endpoint.
  if (!isVideoStudioReasoningModel(params.model)) request.temperature = params.temperature;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`OpenAI proposal failed with HTTP ${response.status}`);
  const payload = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown; type?: unknown }> }> };
  if (typeof payload.output_text === "string") return payload.output_text;
  const text = payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text" && typeof item.text === "string")?.text;
  if (typeof text !== "string") throw new Error("OpenAI no devolvió una propuesta de texto.");
  return text;
}

function extractJson(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("La respuesta no contiene JSON.");
}
