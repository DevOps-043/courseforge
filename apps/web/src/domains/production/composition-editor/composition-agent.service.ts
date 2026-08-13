import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getOptionalGeminiApiKey } from "@/lib/server/env";
import { getHyperframesGenerationSettings } from "../hyperframes/hyperframes-generation-settings.service";
import type { CompositionEditorDocument } from "./composition-document.types";
import { applyCompositionEditorPatches } from "./editor-patch.service";
import { compositionEditorPatchRequestSchema } from "./editor-patch.types";

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
  const apiKey = getOptionalGeminiApiKey();
  if (!apiKey) {
    throw new CompositionAgentProposalError("No hay un modelo configurado para proponer esta edici\u00f3n.", 503);
  }

  const selected = input.selectedClipId
    ? params.document.clips.find((clip) => clip.id === input.selectedClipId) || null
    : null;
  const compactDocument = {
    canvas: params.document.canvas,
    clips: params.document.clips.map((clip) => ({
      durationSeconds: clip.durationSeconds,
      hidden: clip.hidden,
      id: clip.id,
      kind: clip.kind,
      label: clip.label,
      layout: clip.layout,
      startSeconds: clip.startSeconds,
      trackId: clip.trackId,
    })),
    selectedClipId: selected?.id || null,
    tracks: params.document.tracks.map((track) => ({ id: track.id, kind: track.kind, locked: track.locked, label: track.label })),
  };
  try {
    const client = new GoogleGenAI({ apiKey });
    const result = await client.models.generateContent({
      model: settings.agentModel,
      contents: [{ role: "user", parts: [{ text: [
        "Eres un asistente de edici\u00f3n de video. Prop\u00f3n cambios seguros para un documento de composici\u00f3n.",
        "Responde SOLO JSON con {summary, operations}. summary debe explicar en espa\u00f1ol, de forma concreta y en futuro, qu\u00e9 har\u00e1s antes de que el usuario confirme. Cada operaci\u00f3n debe ser una de: clip.move, clip.duration, clip.layout, clip.visibility.",
        "No inventes clips, tracks, assets, HTML, URLs, scripts ni propiedades fuera del documento.",
        "La propuesta NO se guarda todav\u00eda. Mant\u00e9n el resultado entre 1 y 12 operaciones.",
        `Solicitud del usuario: ${input.instruction}`,
        `Documento disponible: ${JSON.stringify(compactDocument)}`,
      ].join("\n") }] }],
      config: { responseMimeType: "application/json", temperature: settings.temperature },
    });
    const raw = JSON.parse(extractJson(result.text || ""));
    const proposal = compositionEditorPatchRequestSchema.parse({ ...raw, source: "AGENT" });
    // Apply once on the server now, so an invalid proposal cannot reach the approval UI.
    applyCompositionEditorPatches(params.document, proposal.operations);
    return { ...proposal, model: settings.agentModel };
  } catch (error) {
    if (error instanceof CompositionAgentProposalError || error instanceof z.ZodError) throw error;
    throw new CompositionAgentProposalError("El agente no produjo una propuesta de edici\u00f3n v\u00e1lida. Puedes ajustar la instrucci\u00f3n y reintentar.", 422);
  }
}

function extractJson(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("La respuesta no contiene JSON.");
}
