import { CompositionAgentProviderError } from "./composition-agent-provider.service";
import { CompositionAgentValidationError } from "./composition-agent-validation.service";
import { CompositionEditorPatchError } from "./editor-patch.service";
import type { VideoStudioModelProvider } from "../hyperframes/video-studio-model-options";

export const COMPOSITION_AGENT_MAX_ATTEMPTS = 3;
export const COMPOSITION_AGENT_RECOVERY_DEADLINE_MS = 45_000;
const COMPOSITION_AGENT_ATTEMPT_TIMEOUT_MS = 20_000;
const COMPOSITION_AGENT_TRANSIENT_RETRY_DELAY_MS = 250;

export interface CompositionAgentModelRuntime {
  apiKey: string;
  model: string;
  provider: VideoStudioModelProvider;
}

export interface CompositionAgentRecoveryMetadata {
  attemptCount: number;
  repaired: boolean;
  usedFallback: boolean;
}

export interface CompositionAgentAttemptContext extends CompositionAgentModelRuntime {
  attempt: number;
  mode: "FALLBACK" | "PRIMARY" | "REPAIR" | "RETRY";
  prompt: string;
  temperature: number;
  timeoutMs: number;
}

export class CompositionAgentRecoveryDeadlineError extends Error {
  readonly code = "COMPOSITION_AGENT_RECOVERY_DEADLINE_EXCEEDED";

  constructor() {
    super("El agente agotó el tiempo disponible para recuperar la propuesta.");
  }
}

interface RecoveryParams<T> {
  attempt: (context: CompositionAgentAttemptContext) => Promise<T>;
  fallback: CompositionAgentModelRuntime | null;
  now?: () => number;
  onAttemptFailure?: (event: {
    attempt: number;
    code: string;
    mode: CompositionAgentAttemptContext["mode"];
    model: string;
    provider: VideoStudioModelProvider;
    providerStatus: number | null;
  }) => void;
  primary: CompositionAgentModelRuntime;
  prompt: string;
  sleep?: (milliseconds: number) => Promise<void>;
  temperature: number;
}

/**
 * Executes a bounded recovery state machine. It never persists intermediate
 * output and delegates final policy/simulation validation to the supplied attempt.
 */
export async function recoverCompositionAgentProposal<T>(params: RecoveryParams<T>) {
  const now = params.now || Date.now;
  const sleep = params.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadlineAt = now() + COMPOSITION_AGENT_RECOVERY_DEADLINE_MS;
  let attemptCount = 0;
  let lastError: unknown;

  const execute = async (
    runtime: CompositionAgentModelRuntime,
    mode: CompositionAgentAttemptContext["mode"],
    prompt: string,
    temperature: number,
  ) => {
    if (attemptCount >= COMPOSITION_AGENT_MAX_ATTEMPTS) throw lastError;
    const remainingMs = deadlineAt - now();
    if (remainingMs < 1_000) throw new CompositionAgentRecoveryDeadlineError();
    attemptCount += 1;
    try {
      return await params.attempt({
        ...runtime,
        attempt: attemptCount,
        mode,
        prompt,
        temperature,
        timeoutMs: Math.min(COMPOSITION_AGENT_ATTEMPT_TIMEOUT_MS, remainingMs),
      });
    } catch (error) {
      lastError = error;
      params.onAttemptFailure?.({
        attempt: attemptCount,
        code: recoveryErrorCode(error),
        mode,
        model: runtime.model,
        provider: runtime.provider,
        providerStatus: error instanceof CompositionAgentProviderError ? error.providerStatus : null,
      });
      throw error;
    }
  };

  try {
    const result = await execute(params.primary, "PRIMARY", params.prompt, params.temperature);
    return recoveryResult(result, params.primary.model, attemptCount, false, false);
  } catch (primaryError) {
    if (isRepairableProposalFailure(primaryError) && attemptCount < COMPOSITION_AGENT_MAX_ATTEMPTS) {
      try {
        const result = await execute(
          params.primary,
          "REPAIR",
          buildCompositionAgentRepairPrompt(params.prompt, primaryError),
          0,
        );
        return recoveryResult(result, params.primary.model, attemptCount, true, false);
      } catch {
        // The final branch below may still use the independently configured fallback.
      }
    } else if (isTransientProviderFailure(primaryError) && attemptCount < COMPOSITION_AGENT_MAX_ATTEMPTS) {
      try {
        await sleep(COMPOSITION_AGENT_TRANSIENT_RETRY_DELAY_MS);
        const result = await execute(params.primary, "RETRY", params.prompt, params.temperature);
        return recoveryResult(result, params.primary.model, attemptCount, false, false);
      } catch {
        // The final branch below may still use the independently configured fallback.
      }
    }

    if (params.fallback && attemptCount < COMPOSITION_AGENT_MAX_ATTEMPTS && isFallbackEligible(lastError || primaryError)) {
      const result = await execute(
        params.fallback,
        "FALLBACK",
        buildCompositionAgentFallbackPrompt(params.prompt, lastError || primaryError),
        0,
      );
      return recoveryResult(result, params.fallback.model, attemptCount, false, true);
    }

    throw lastError || primaryError;
  }
}

function recoveryResult<T>(
  value: T,
  model: string,
  attemptCount: number,
  repaired: boolean,
  usedFallback: boolean,
) {
  return {
    model,
    recovery: { attemptCount, repaired, usedFallback } satisfies CompositionAgentRecoveryMetadata,
    value,
  };
}

function isRepairableProposalFailure(error: unknown) {
  return error instanceof CompositionAgentValidationError
    || error instanceof CompositionEditorPatchError
    || (error instanceof CompositionAgentProviderError
      && (error.code === "PROVIDER_INVALID_JSON" || error.code === "PROVIDER_INVALID_OUTPUT"));
}

function isTransientProviderFailure(error: unknown) {
  if (!(error instanceof CompositionAgentProviderError) || error.code !== "PROVIDER_REQUEST_FAILED") return false;
  return error.providerStatus === 408
    || error.providerStatus === 429
    || error.providerStatus === 504
    || (error.providerStatus !== null && error.providerStatus >= 500);
}

function isFallbackEligible(error: unknown) {
  if (isRepairableProposalFailure(error) || isTransientProviderFailure(error)) return true;
  return error instanceof CompositionAgentProviderError
    && error.code === "PROVIDER_REQUEST_FAILED"
    && (error.providerStatus === 400 || error.providerStatus === 404);
}

function buildCompositionAgentRepairPrompt(originalPrompt: string, error: unknown) {
  const issues = error instanceof CompositionAgentValidationError
    ? error.issues.slice(0, 6).map((issue) => `${issue.code}${issue.entityId ? ` (${issue.entityId})` : ""}: ${issue.message}`)
    : [`${recoveryErrorCode(error)}: ${safeRecoveryMessage(error)}`];
  return `${originalPrompt}\nRECOVERY_INSTRUCTION: La propuesta anterior fue descartada y no se aplicó. Genera una propuesta completa nueva corrigiendo exclusivamente estos errores:\n- ${issues.join("\n- ")}\nNo repitas una operación inválida, no agregues cambios no solicitados y usa únicamente IDs presentes en el contexto.`;
}

function buildCompositionAgentFallbackPrompt(originalPrompt: string, error: unknown) {
  return `${originalPrompt}\nFALLBACK_INSTRUCTION: El modelo principal no pudo producir una propuesta utilizable (${recoveryErrorCode(error)}). Genera una propuesta completa desde cero, mínima y ajustada estrictamente al contrato y a los IDs del contexto.`;
}

function recoveryErrorCode(error: unknown) {
  if (error instanceof CompositionAgentProviderError) return error.code;
  if (error instanceof CompositionAgentValidationError) return error.issues[0]?.code || "AGENT_VALIDATION_FAILED";
  if (error instanceof CompositionEditorPatchError) return "AGENT_PATCH_REJECTED";
  return "AGENT_ATTEMPT_FAILED";
}

function safeRecoveryMessage(error: unknown) {
  if (error instanceof CompositionAgentProviderError) return "La salida no cumplió el contrato estructurado.";
  if (error instanceof CompositionEditorPatchError) return error.message.slice(0, 300);
  return "La propuesta no superó la validación.";
}
