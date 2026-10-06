import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlEditingInitializationOperationHandler } from "@/domains/production/composition-editor/http/composition-html-editing-initialization-operation-handler.server";
import { htmlEditingInitializationReceiptsEnabled } from "@/domains/production/composition-editor/composition-html-editing-initialization-operation-http-policy";
import { htmlEditingInitializationEnabled } from "@/domains/production/composition-editor/composition-html-editing-initialization-http.contract";
import { htmlEditingInspectorEnabled } from "@/domains/production/composition-editor/composition-html-editing-inspector-http-policy";
import { HtmlEditingTemplateCatalog } from "@/domains/production/composition-editor/html-editing/html-editing-template-catalog.server";
import { CompositionHtmlEditingBootstrapHost } from "@/domains/production/composition-editor/composition-html-editing-bootstrap-host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlEditingInitializationOperationHandler({
  enabled: method => htmlEditingInitializationReceiptsEnabled(process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_RECEIPTS_ENABLED)
    && htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED)
    && (method === "GET" || htmlEditingInitializationEnabled(process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED)),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  register: (client, input, signal) => new CompositionHtmlEditingBootstrapHost(client,
    new HtmlEditingTemplateCatalog(process.env.COMPOSITION_HTML_EDITING_CATALOG_JSON ?? "")).registerOperation(input, signal),
  logFailure: requestId => createOperationalLogger("production.html_editing.initialization_receipt", { correlationId: requestId })
    .warn("production.html_editing.initialization_receipt_unconfirmed", { reason: "SAFE_INITIALIZATION_RECEIPT_UNCONFIRMED" }),
});
type Context = { params: Promise<{ draftId: string; clipId: string; operationId: string }> };
export async function POST(request: Request, context: Context) { return handle(request, await context.params); }
export async function GET(request: Request, context: Context) { return handle(request, await context.params); }
