import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlTemplateChoicesHandler } from "@/domains/production/composition-editor/http/composition-html-editing-template-choices-handler.server";
import { htmlEditingInitializationEnabled } from "@/domains/production/composition-editor/composition-html-editing-initialization-http.contract";
import { htmlEditingInspectorEnabled } from "@/domains/production/composition-editor/composition-html-editing-inspector-http-policy";
import { HtmlEditingTemplateCatalog } from "@/domains/production/composition-editor/html-editing/html-editing-template-catalog.server";
import { CompositionHtmlEditingBootstrapHost } from "@/domains/production/composition-editor/composition-html-editing-bootstrap-host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlTemplateChoicesHandler({
  enabled: () => htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED)
    && htmlEditingInitializationEnabled(process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  read: (client, command, signal) => new CompositionHtmlEditingBootstrapHost(client,
    new HtmlEditingTemplateCatalog(process.env.COMPOSITION_HTML_EDITING_CATALOG_JSON ?? "")).listTemplateChoices(command, signal),
  logFailure: requestId => createOperationalLogger("production.html_editing.template_choices", { correlationId: requestId })
    .warn("production.html_editing.template_choices_unavailable", { reason: "SAFE_TEMPLATE_CHOICES_UNAVAILABLE" }),
});
type Context = { params: Promise<{ draftId: string; clipId: string }> };
export async function GET(request: Request, context: Context) { return handle(request, await context.params); }
