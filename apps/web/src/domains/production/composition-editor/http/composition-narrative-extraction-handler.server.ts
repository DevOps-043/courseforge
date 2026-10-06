import { narrativeExtractionCommandResultSchema, narrativeExtractionApplyRequestSchema } from "../composition-narrative-extraction-contract";
import { applyNarrativeVoiceExtraction, recoverNarrativeVoiceExtraction,
  type NarrativeExtractionCommandRepository } from "../composition-narrative-extraction-apply.service";
import type { NarrativeExtractionReadRepository } from "../composition-narrative-extraction-query";
import { createNarrativeCommandHttpHandler } from "./composition-narrative-command-handler.server";

export type NarrativeExtractionHttpAuthorization = { status: "AUTHORIZED"; organizationId: string; userId: string }
  | { status: "AUTH_REQUIRED" | "TENANT_FORBIDDEN" | "ROLE_FORBIDDEN" };
export interface NarrativeExtractionHttpDependencies {
  enabled: () => boolean;
  configuredAppUrl: () => string | null;
  authorize: () => Promise<NarrativeExtractionHttpAuthorization>;
  consumeRateLimit: (scope: { organizationId: string; userId: string }, purpose: "APPLY" | "RECOVERY", signal: AbortSignal) => Promise<
    { status: "ALLOWED" | "UNAVAILABLE" } | { status: "LIMITED"; retryAfterSeconds: number }>;
  /** Must verify current draft/composition access before returning scoped repositories. */
  loadServices: (scope: { organizationId: string; userId: string; draftId: string }, signal: AbortSignal) => Promise<
    { reads: NarrativeExtractionReadRepository; commands: NarrativeExtractionCommandRepository } | null>;
  logFailure?: (requestId: string, error: unknown, commandId?: string) => void;
}

/** Voice-specific adapter; HTTP safety and uncertainty semantics are shared with audiovisual commands. */
export function createNarrativeExtractionHttpHandler(mode: "APPLY" | "RECOVERY", dependencies: NarrativeExtractionHttpDependencies) {
  return createNarrativeCommandHttpHandler(mode, { ...dependencies, commandSchema: narrativeExtractionApplyRequestSchema,
    unconfirmed: commandId => narrativeExtractionCommandResultSchema.parse({ contract: "NARRATIVE_EXTRACTION_COMMAND_RESULT_V1",
      status: "UNCONFIRMED", commandId, automaticRetryAllowed: false, recoveryRequired: true }),
    async execute(operation, { services, request, draftId, organizationId, userId }) {
      const parameters = { request, draftId, organizationId, userId, ...services };
      const result = operation === "APPLY" ? await applyNarrativeVoiceExtraction(parameters)
        : await recoverNarrativeVoiceExtraction(parameters);
      if (!result.ok) return result;
      const status = "outcome" in result ? result.outcome : "CONFIRMED";
      return { ok: true, data: narrativeExtractionCommandResultSchema.parse({
        contract: "NARRATIVE_EXTRACTION_COMMAND_RESULT_V1", status,
        commandId: result.receipt.commandId, documentHash: result.receipt.documentHash, version: result.receipt.version,
        newClipId: result.receipt.newClipId, scope: "DATABASE_COMMIT_ONLY", reloadDocumentRequired: true,
        automaticRetryAllowed: false, recoveryRequired: false,
      }) };
    },
  });
}
