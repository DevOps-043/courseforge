import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createGeneratedDeckInitializationHandler } from "@/domains/production/composition-editor/http/composition-generated-deck-initialization-handler.server";
import { GeneratedDeckInitializationHost } from "@/domains/production/composition-editor/composition-generated-deck-initialization.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createGeneratedDeckInitializationHandler({
  enabled: () => process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED === "true"
    && process.env.COMPOSITION_HTML_EDITING_INITIALIZATION_RECEIPTS_ENABLED === "true",
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  },
  serviceClient: getServiceRoleClient,
  read: (client, owner, identity, signal) => new GeneratedDeckInitializationHost(client).readOperation(owner, identity, signal),
  initialize: (client, owner, request, signal) => new GeneratedDeckInitializationHost(client).initialize(owner, request, signal),
  logFailure: requestId => createOperationalLogger("production.generated_deck.initialization", { correlationId: requestId })
    .warn("production.generated_deck.initialization_unavailable", { reason: "SAFE_INITIALIZATION_UNAVAILABLE" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) { return handle(request, await context.params); }
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) { return handle(request, await context.params); }
