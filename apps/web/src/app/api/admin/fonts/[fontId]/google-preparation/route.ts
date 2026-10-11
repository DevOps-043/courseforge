import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { BoundedConcurrencyLimiter } from "@/lib/server/external-import-concurrency";
import { GOOGLE_FONT_PREPARATION_POLICY } from "@/domains/production/fonts/google-font-preparation-policy";
import { handleGoogleFontPreparation } from "@/domains/production/fonts/google-font-preparation-handler.server";
import { ORGANIZATION_FONT_TABLE } from "@/domains/production/fonts/organization-font.types";
import { createGoogleFontBundleStore, createGoogleFontBundleStorage, createGoogleFontAdmissionRepository } from "@/domains/production/fonts/google-font-bundle-adapters.server";
import { admitPreparedGoogleFont } from "@/domains/production/fonts/google-font-admission.server";
import { persistRegisteredGoogleFont } from "@/domains/production/fonts/google-font-bundle-store.server";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "@/lib/server/env";

export const runtime = "nodejs";
const policy = GOOGLE_FONT_PREPARATION_POLICY;
// Per-instance backpressure, not a distributed rate-limit or permission cache.
const capacity = new BoundedConcurrencyLimiter(policy.concurrentPreparations, policy.queuedPreparations, policy.queueTimeoutMs);
const headers = { "cache-control": "private, no-store", Vary: "Cookie, Authorization, Origin" };

export async function POST(request: Request, context: { params: Promise<{ fontId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const result = await handleGoogleFontPreparation(request, await context.params, {
    capacity,
    async authenticate() {
      const user = await getAuthenticatedUser(await createClient());
      if (!user) return { authenticated: false, organizationId: null, platformRole: null };
      const tenant = await resolveActiveTenantContext();
      return { authenticated: true, organizationId: tenant?.organizationId ?? null, platformRole: tenant?.platformRole ?? null, actorId: user.userId };
    },
    repository: { async readFont(organizationId, fontId, signal) {
      const result = await getServiceRoleClient().from(ORGANIZATION_FONT_TABLE).select("id,organization_id,family,source,css_url,status")
        .eq("id", fontId).eq("organization_id", organizationId).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error("GOOGLE_FONT_REGISTRY_UNAVAILABLE");
      return result.data;
    } },
    recordFailure(reason) {
      createOperationalLogger("admin.fonts.google_preparation", { correlationId: requestId })
        .warn("fonts.google_preparation_unavailable", { reason });
    },
    async materialize(input) {
      return persistRegisteredGoogleFont({ ...input, repository: createGoogleFontBundleStore(getServiceRoleClient()),
        storage: createGoogleFontBundleStorage({ supabaseUrl: getSupabaseUrl(), serviceRoleKey: getSupabaseServiceRoleKey() }) });
    },
    async admit(input) {
      return admitPreparedGoogleFont({ ...input, repository: createGoogleFontAdmissionRepository(getServiceRoleClient()),
        storage: createGoogleFontBundleStorage({ supabaseUrl: getSupabaseUrl(), serviceRoleKey: getSupabaseServiceRoleKey() }) });
    },
  });
  if ("preparation" in result) return apiSuccessResponse({ preparation: result.preparation }, { requestId, headers });
  if ("bundle" in result) return apiSuccessResponse({ bundle: result.bundle }, { requestId, headers });
  if ("admission" in result) return apiSuccessResponse({ admission: result.admission }, { requestId, headers });
  return apiErrorResponse({ ...result, requestId, headers: result.status === 429 ? { ...headers, "Retry-After": "5" } : headers,
    retryable: result.status === 503 || result.status === 429 });
}
