import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getAppUrl } from "@/lib/server/env";
import { createClient } from "@/utils/supabase/server";
import { createNarrativeExtractionHttpHandler, type NarrativeExtractionHttpDependencies } from "./composition-narrative-extraction-handler.server";
import { consumeNarrativeExtractionRateLimit } from "../composition-narrative-extraction-rate-limit";
import { createNarrativeExtractionReadRepository } from "../composition-narrative-extraction.repository";
import { createNarrativeExtractionCommandRepository, createSupabaseNarrativeExtractionRpcTransport } from "../composition-narrative-extraction-command.repository";
import type { NarrativeExtractionHttpAuthorization } from "./composition-narrative-extraction-handler.server";

export async function authorizeServerNarrativeExtraction(): Promise<NarrativeExtractionHttpAuthorization> {
  const user = await getAuthenticatedUser(await createClient());
  if (!user) return { status: "AUTH_REQUIRED" };
  const tenant = await resolveActiveTenantContext();
  if (!tenant || tenant.userId !== user.userId) return { status: "TENANT_FORBIDDEN" };
  if (!(await canReviewContent(user.userId, tenant))) return { status: "ROLE_FORBIDDEN" };
  return { status: "AUTHORIZED", organizationId: tenant.organizationId, userId: user.userId };
}

/** Composition root. Both gates default closed; route composition supplies explicit rollout policies. */
export function createServerNarrativeExtractionHandlers(options: { enabled?: () => boolean; recoveryEnabled?: () => boolean;
  organizationEnabled?: (organizationId: string) => boolean } = {}) {
  const dependencies: NarrativeExtractionHttpDependencies = {
    enabled: options.enabled ?? (() => false), configuredAppUrl: getAppUrl,
    authorize: authorizeServerNarrativeExtraction,
    consumeRateLimit: (scope, purpose, signal) => consumeNarrativeExtractionRateLimit({ ...scope, purpose,
      consume: (policy) => getServiceRoleClient().rpc("consume_api_rate_limit", policy).retry(false).abortSignal(signal) }),
    async loadServices(scope, signal) {
      const admin = getServiceRoleClient();
      const reads = createNarrativeExtractionReadRepository(admin, signal);
      if (!(await reads.readComponentId(scope.draftId, scope.organizationId))) return null;
      const commands = createNarrativeExtractionCommandRepository(reads, createSupabaseNarrativeExtractionRpcTransport(admin, signal));
      return { reads, commands };
    },
  };
  return { apply: createNarrativeExtractionHttpHandler("APPLY", { ...dependencies, async authorize() {
    const authorized = await dependencies.authorize();
    if (authorized.status === "AUTHORIZED" && options.organizationEnabled && !options.organizationEnabled(authorized.organizationId)) return { status: "ROLE_FORBIDDEN" };
    return authorized;
  } }), recover: createNarrativeExtractionHttpHandler("RECOVERY", { ...dependencies,
    enabled: options.recoveryEnabled ?? dependencies.enabled }) };
}
