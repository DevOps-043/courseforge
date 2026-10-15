import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlEditingOperationHandler } from "@/domains/production/composition-editor/http/composition-html-editing-operation-handler.server";
import { htmlEditingOperationReceiptsEnabled } from "@/domains/production/composition-editor/composition-html-editing-operation-http-policy";
import { htmlEditingInspectorEnabled } from "@/domains/production/composition-editor/composition-html-editing-inspector-http-policy";
import { htmlEditingMutationEnabled } from "@/domains/production/composition-editor/composition-html-editing-mutation.contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlEditingOperationHandler({
  enabled: method => htmlEditingOperationReceiptsEnabled(process.env.COMPOSITION_HTML_EDITING_OPERATION_RECEIPTS_ENABLED)
    && htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED)
    && (method === "GET" || htmlEditingMutationEnabled(process.env.COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED)),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  logFailure: requestId => createOperationalLogger("production.html_editing.operation", { correlationId: requestId })
    .warn("production.html_editing.operation_unverified", { reason: "SAFE_OPERATION_RESULT_UNVERIFIED" }),
});
type Context = { params: Promise<{ draftId: string; clipId: string; operationId: string }> };
export async function GET(request: Request, context: Context) { return handle(request, await context.params); }
export async function POST(request: Request, context: Context) { return handle(request, await context.params); }
