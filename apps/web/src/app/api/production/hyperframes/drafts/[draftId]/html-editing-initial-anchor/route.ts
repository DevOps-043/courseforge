import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlInitialAnchorHandler } from "@/domains/production/composition-editor/http/composition-html-initial-anchor-handler.server";
import { readHtmlInitialAnchor, prepareHtmlInitialAnchor } from "@/domains/production/composition-editor/composition-html-initial-anchor.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlInitialAnchorHandler({
  enabled: () => process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true",
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient, read: readHtmlInitialAnchor, prepare: prepareHtmlInitialAnchor,
  logFailure: requestId => createOperationalLogger("production.html_editing.initial_anchor", { correlationId: requestId })
    .warn("production.html_editing.initial_anchor_unavailable", { reason: "SAFE_ANCHOR_UNAVAILABLE" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) { return handle(request, await context.params); }
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) { return handle(request, await context.params); }
