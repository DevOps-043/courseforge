import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlEditingInspectorHandler } from "@/domains/production/composition-editor/http/composition-html-editing-inspector-handler.server";
import { htmlEditingInspectorEnabled } from "@/domains/production/composition-editor/composition-html-editing-inspector-http-policy";
import { createHtmlEditingMutationHandler } from "@/domains/production/composition-editor/http/composition-html-editing-mutation-handler.server";
import { htmlEditingMutationEnabled } from "@/domains/production/composition-editor/composition-html-editing-mutation.contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function authenticateEditorialRequest() {
  const user = await getAuthenticatedUser(await createClient());
  return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
}
const handle = createHtmlEditingInspectorHandler({
  enabled: () => htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED),
  authenticate: authenticateEditorialRequest,
  serviceClient: getServiceRoleClient,
  logFailure: requestId => createOperationalLogger("production.html_editing.inspector", { correlationId: requestId })
    .warn("production.html_editing.inspector_read_unavailable", { reason: "SAFE_INSPECTOR_READ_UNAVAILABLE" }),
});
const mutate = createHtmlEditingMutationHandler({
  enabled: () => htmlEditingMutationEnabled(process.env.COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED)
    && htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED),
  authenticate: authenticateEditorialRequest,
  serviceClient: getServiceRoleClient,
  logFailure: requestId => createOperationalLogger("production.html_editing.mutation", { correlationId: requestId })
    .warn("production.html_editing.mutation_unconfirmed", { reason: "SAFE_EDITORIAL_MUTATION_UNCONFIRMED" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string; clipId: string }> }) {
  return handle(request, await context.params);
}
export async function POST(request: Request, context: { params: Promise<{ draftId: string; clipId: string }> }) {
  return mutate(request, await context.params);
}
