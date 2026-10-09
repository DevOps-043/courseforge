import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlLegacyAdoptionHandler } from "@/domains/production/composition-editor/http/composition-html-editing-legacy-adoption-handler.server";
import { htmlLegacyAdoptionEnabled } from "@/domains/production/composition-editor/composition-html-editing-legacy-adoption-http-policy";
import { SupabaseHtmlLegacyAdoptionRepository } from "@/domains/production/composition-editor/composition-html-editing-legacy-adoption-repository.server";
import { HtmlEditingTemplateCatalog } from "@/domains/production/composition-editor/html-editing/html-editing-template-catalog.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlLegacyAdoptionHandler({
  enabled: method => htmlLegacyAdoptionEnabled(method, process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  commit: (client, command, signal) => new SupabaseHtmlLegacyAdoptionRepository(client,
    new HtmlEditingTemplateCatalog(process.env.COMPOSITION_HTML_EDITING_CATALOG_JSON ?? "")).commit(command, signal),
  read: (client, command, signal) => new SupabaseHtmlLegacyAdoptionRepository(client).readOperation(command, signal),
  logFailure: requestId => createOperationalLogger("production.html_editing.legacy_adoption", { correlationId: requestId })
    .warn("production.html_editing.legacy_adoption_unconfirmed", { reason: "SAFE_LEGACY_ADOPTION_UNCONFIRMED" }),
});
type Context = { params: Promise<{ draftId: string; clipId: string; operationId: string }> };
export async function POST(request: Request, context: Context) { return handle(request, await context.params); }
export async function GET(request: Request, context: Context) { return handle(request, await context.params); }
