import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlLegacyReviewHandler } from "@/domains/production/composition-editor/http/composition-html-editing-legacy-review-handler.server";
import { htmlLegacyAdoptionEnabled } from "@/domains/production/composition-editor/composition-html-editing-legacy-adoption-http-policy";
import { SupabaseHtmlLegacyAdoptionRepository } from "@/domains/production/composition-editor/composition-html-editing-legacy-adoption-repository.server";
import { HtmlEditingTemplateCatalog } from "@/domains/production/composition-editor/html-editing/html-editing-template-catalog.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlLegacyReviewHandler({
  enabled: () => htmlLegacyAdoptionEnabled("GET", process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  read: (client, command, signal) => new SupabaseHtmlLegacyAdoptionRepository(client,
    new HtmlEditingTemplateCatalog(process.env.COMPOSITION_HTML_EDITING_CATALOG_JSON ?? "")).readReviewedCandidate(command, signal),
  logFailure: requestId => createOperationalLogger("production.html_editing.legacy_review", { correlationId: requestId })
    .warn("production.html_editing.legacy_review_unavailable", { reason: "SAFE_LEGACY_REVIEW_UNAVAILABLE" }),
});
type Context = { params: Promise<{ draftId: string; clipId: string; candidateId: string }> };
export async function GET(request: Request, context: Context) { return handle(request, await context.params); }
