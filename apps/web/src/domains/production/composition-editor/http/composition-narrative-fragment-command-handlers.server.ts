import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { getAppUrl } from "@/lib/server/env";
import { authorizeServerNarrativeExtraction } from "./composition-narrative-extraction-handlers.server";
import { createNarrativeFragmentCommandHttpHandler, type NarrativeFragmentCommandHttpDependencies } from "./composition-narrative-fragment-command-handler.server";
import { consumeNarrativeExtractionRateLimit } from "../composition-narrative-extraction-rate-limit";
import { createNarrativeFragmentReadRepository } from "../composition-narrative-fragment.repository";
import { createNarrativeFragmentCommandRepository, createSupabaseNarrativeFragmentRpcTransport } from "../composition-narrative-fragment-command.repository";

/** Independent audiovisual rollout; current authorization is mandatory even during recovery. */
export function createServerNarrativeFragmentCommandHandlers(options: { enabled?: () => boolean;
  recoveryEnabled?: () => boolean; organizationEnabled?: (organizationId: string) => boolean } = {}) {
  const dependencies: NarrativeFragmentCommandHttpDependencies = {
    enabled: options.enabled ?? (() => false), configuredAppUrl: getAppUrl,
    authorize: authorizeServerNarrativeExtraction,
    consumeRateLimit: (scope, purpose, signal) => consumeNarrativeExtractionRateLimit({ ...scope, purpose,
      consume: policy => getServiceRoleClient().rpc("consume_api_rate_limit", policy).retry(false).abortSignal(signal) }),
    async loadServices(scope, signal) {
      const admin = getServiceRoleClient();
      const reads = createNarrativeFragmentReadRepository(admin, signal);
      if (!(await reads.readComponentId(scope.draftId, scope.organizationId))) return null;
      return { reads, commands: createNarrativeFragmentCommandRepository(reads,
        createSupabaseNarrativeFragmentRpcTransport(admin, signal)) };
    },
  };
  return { apply: createNarrativeFragmentCommandHttpHandler("APPLY", { ...dependencies, async authorize() {
    const authorized = await dependencies.authorize();
    if (authorized.status === "AUTHORIZED" && (!options.organizationEnabled
      || !options.organizationEnabled(authorized.organizationId))) return { status: "ROLE_FORBIDDEN" };
    return authorized;
  } }), recover: createNarrativeFragmentCommandHttpHandler("RECOVERY", { ...dependencies,
    enabled: options.recoveryEnabled ?? (() => false) }) };
}
