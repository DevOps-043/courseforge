import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlEditingInitializationHandler } from "@/domains/production/composition-editor/http/composition-html-editing-initialization-handler.server";
import { htmlEditingInitializationEnabled } from "@/domains/production/composition-editor/composition-html-editing-initialization-http.contract";
import { HtmlEditingTemplateCatalog } from "@/domains/production/composition-editor/html-editing/html-editing-template-catalog.server";
import { CompositionHtmlEditingBootstrapHost } from "@/domains/production/composition-editor/composition-html-editing-bootstrap-host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlEditingInitializationHandler({
  enabled: () => htmlEditingInitializationEnabled(process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  register: (client, input, signal) => {
    // Operator-managed tenant-scoped configuration only, never request JSON/URL.
    const catalog = new HtmlEditingTemplateCatalog(process.env.COMPOSITION_HTML_EDITING_CATALOG_JSON ?? "");
    return new CompositionHtmlEditingBootstrapHost(client, catalog).register(input, signal);
  },
  logFailure: requestId => createOperationalLogger("production.html_editing.initialization", { correlationId: requestId })
    .warn("production.html_editing.initialization_unconfirmed", { reason: "SAFE_INITIALIZATION_UNCONFIRMED" }),
});
export async function POST(request: Request, context: { params: Promise<{ draftId: string; clipId: string }> }) {
  return handle(request, await context.params);
}
