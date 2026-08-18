import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "@/lib/server/env";
import { getHyperframesGenerationSettings } from "../hyperframes/hyperframes-generation-settings.service";
import { getVideoStudioModelProvider } from "../hyperframes/video-studio-model-options";
import type { CompositionEditorDocument } from "./composition-document.types";
import { buildCompositionAgentProposal } from "./composition-agent-proposal.service";
import { requestCompositionAgentPatch, CompositionAgentProviderError } from "./composition-agent-provider.service";
import {
  recoverCompositionAgentProposal,
  CompositionAgentRecoveryDeadlineError,
  type CompositionAgentModelRuntime,
} from "./composition-agent-recovery.service";
import {
  buildCompositionAgentContext,
  buildCompositionProposalPrompt,
} from "./composition-agent-prompt.service";
import { COMPOSITION_MOTION_ENABLED, isCompositionMotionOperation } from "./composition-motion.config";

export class CompositionAgentProposalError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "COMPOSITION_AGENT_PROPOSAL_FAILED",
    readonly retryable = false,
  ) {
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
  baseDocumentHash: string;
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
  const primary = resolveModelRuntime(settings.agentModel, true)!;
  const fallback = settings.fallbackModel
    ? resolveModelRuntime(settings.fallbackModel, false)
    : null;

  const selected = input.selectedClipId
    ? params.document.clips.find((clip) => clip.id === input.selectedClipId) || null
    : null;
  const context = buildCompositionAgentContext(params.document, selected?.id || null);
  try {
    const prompt = buildCompositionProposalPrompt({
      context,
      instruction: input.instruction,
      selectedClipId: selected?.id || null,
    });
    const recovered = await recoverCompositionAgentProposal({
      attempt: async (attempt) => {
        const patch = await requestCompositionAgentPatch({
          apiKey: attempt.apiKey,
          model: attempt.model,
          prompt: attempt.prompt,
          provider: attempt.provider,
          temperature: attempt.temperature,
          timeoutMs: attempt.timeoutMs,
        });
        if (!COMPOSITION_MOTION_ENABLED && patch.operations.some((operation) => isCompositionMotionOperation(operation.type))) {
          throw new CompositionAgentProposalError("La edición de animaciones está deshabilitada temporalmente.", 409);
        }
        return buildCompositionAgentProposal({
          baseDocumentHash: params.baseDocumentHash,
          document: params.document,
          patch,
          proposalId: randomUUID(),
        });
      },
      fallback,
      onAttemptFailure: (event) => console.warn("[CompositionAgent] Attempt failed", {
        ...event,
        event: "composition_agent_attempt_failed",
      }),
      primary,
      prompt,
      temperature: settings.temperature,
    });
    return { ...recovered.value, model: recovered.model, recovery: recovered.recovery };
  } catch (error) {
    if (error instanceof CompositionAgentProposalError) throw error;
    if (error instanceof CompositionAgentProviderError) {
      console.error("[CompositionAgent] Provider failure", {
        code: error.code,
        event: "composition_agent_provider_failed",
        configuredPrimaryModel: settings.agentModel,
        provider: error.provider,
        providerStatus: error.providerStatus,
      });
      if (error.code === "PROVIDER_INVALID_JSON" || error.code === "PROVIDER_INVALID_OUTPUT") {
        throw new CompositionAgentProposalError(
          "El agente no produjo una propuesta estructurada válida. Intenta reformular la solicitud.",
          422,
          error.code,
        );
      }
      const isTimeout = error.providerStatus === 408 || error.providerStatus === 504;
      throw new CompositionAgentProposalError(
        error.providerStatus === 404
          ? "El modelo configurado ya no está disponible. Selecciona un modelo vigente en Configuración."
          : "El proveedor de IA no pudo generar la propuesta. Vuelve a intentar en unos segundos.",
        isTimeout ? 504 : 503,
        "COMPOSITION_AGENT_PROVIDER_UNAVAILABLE",
        true,
      );
    }
    if (error instanceof CompositionAgentRecoveryDeadlineError) {
      throw new CompositionAgentProposalError(error.message, 504, error.code, true);
    }
    console.error("[CompositionAgent] Proposal validation failure", {
      errorType: error instanceof z.ZodError ? "ZodError" : error instanceof Error ? error.constructor.name : "unknown",
      event: "composition_agent_proposal_invalid",
      model: settings.agentModel,
      provider: primary.provider,
    });
    throw new CompositionAgentProposalError("El agente no produjo una propuesta de edici\u00f3n v\u00e1lida. Puedes ajustar la instrucci\u00f3n y reintentar.", 422);
  }
}

function resolveModelRuntime(model: string, required: boolean): CompositionAgentModelRuntime | null {
  const provider = getVideoStudioModelProvider(model);
  if (!provider) {
    if (required) throw new CompositionAgentProposalError("El modelo de edición configurado no es compatible.", 400);
    return null;
  }
  const apiKey = provider === "gemini" ? getOptionalGeminiApiKey() : getOptionalOpenAIApiKey();
  if (!apiKey) {
    if (required) {
      throw new CompositionAgentProposalError(`No hay una API key configurada para ${provider === "openai" ? "OpenAI" : "Gemini"}.`, 503);
    }
    return null;
  }
  return { apiKey, model, provider };
}
