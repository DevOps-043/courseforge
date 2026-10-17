import { z } from "zod";
import { createNarrativeCommandHttpHandler, type NarrativeCommandHttpDependencies } from "./composition-narrative-command-handler.server";
import { narrativeFragmentApplyRequestSchema, narrativeFragmentCommandResultSchema,
  type NarrativeFragmentApplyRequest } from "../composition-narrative-fragment-command-contract";
import { applyNarrativeFragment, recoverNarrativeFragment,
  type NarrativeFragmentCommandRepository } from "../composition-narrative-fragment-apply.server";
import type { NarrativeFragmentReadRepository } from "../composition-narrative-fragment-query.server";
import { projectNarrativeFragmentCommandResult } from "../composition-narrative-fragment-command-response.server";

export type NarrativeFragmentCommandHttpDependencies = Pick<NarrativeCommandHttpDependencies<NarrativeFragmentApplyRequest,
  { reads: NarrativeFragmentReadRepository; commands: NarrativeFragmentCommandRepository }>,
  "enabled" | "configuredAppUrl" | "authorize" | "consumeRateLimit" | "loadServices" | "logFailure">;

/** No voice-only writer fallback. Receipt recovery never dispatches another append. */
export function createNarrativeFragmentCommandHttpHandler(mode: "APPLY" | "RECOVERY", dependencies: NarrativeFragmentCommandHttpDependencies) {
  return createNarrativeCommandHttpHandler(mode, { ...dependencies, logNamespace: "production.narrative_fragment.command",
    commandSchema: narrativeFragmentApplyRequestSchema,
    unconfirmed: commandId => narrativeFragmentCommandResultSchema.parse({
      contract: "NARRATIVE_FRAGMENT_COMMAND_RESULT_V1", status: "UNCONFIRMED",
      commandId, automaticRetryAllowed: false, recoveryRequired: true,
    }),
    async execute(operation, { services, ...parameters }) {
      const result = operation === "APPLY" ? await applyNarrativeFragment({ ...parameters, ...services })
        : await recoverNarrativeFragment({ ...parameters, commands: services.commands });
      if (!result.ok) return result;
      const status = "outcome" in result ? z.enum(["COMMITTED", "REPLAYED"]).parse(result.outcome) : "CONFIRMED";
      return { ok: true, data: projectNarrativeFragmentCommandResult(result.receipt, status) };
    },
  });
}
