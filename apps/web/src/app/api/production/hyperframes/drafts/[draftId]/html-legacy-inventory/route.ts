import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { htmlLegacyInventoryEnabled } from "@/domains/production/composition-editor/composition-html-editing-legacy-inventory.contract";
import { createHtmlLegacyInventoryHandler } from "@/domains/production/composition-editor/http/composition-html-editing-legacy-inventory-handler.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlLegacyInventoryHandler({enabled: () => htmlLegacyInventoryEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null};
  }, serviceClient: getServiceRoleClient,
  logFailure: requestId => createOperationalLogger("production.html_editing.legacy_inventory", {correlationId: requestId})
    .warn("production.html_editing.legacy_inventory_unavailable", {reason: "SAFE_INVENTORY_READ_UNAVAILABLE"}),
});
export async function GET(request: Request, context: {params: Promise<{draftId: string}>}) {return handle(request, await context.params);}
