import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlHistoricalPublicationHandler } from "@/domains/production/composition-editor/http/composition-html-editing-historical-publication-handler.server";
import { htmlHistoricalPublicationEnabled } from "@/domains/production/composition-editor/composition-html-editing-historical-publication-http.contract";
import { HistoricalHtmlPublicationRepository } from "@/domains/production/composition-editor/composition-html-editing-historical-publication-repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlHistoricalPublicationHandler({
  enabled: method => htmlHistoricalPublicationEnabled(method, process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null};
  }, serviceClient: getServiceRoleClient,
  commit: (client, command, signal) => new HistoricalHtmlPublicationRepository(client).commit(command, signal),
  read: (client, command, signal) => new HistoricalHtmlPublicationRepository(client).readOperation(command, signal),
  logFailure: requestId => createOperationalLogger("production.html_editing.historical_publication", {correlationId: requestId})
    .warn("production.html_editing.historical_publication_unconfirmed", {reason: "SAFE_HISTORICAL_PUBLICATION_UNCONFIRMED"}),
});
type Context = {params: Promise<{draftId: string; operationId: string}>};
export async function POST(request: Request, context: Context) {return handle(request, await context.params);}
export async function GET(request: Request, context: Context) {return handle(request, await context.params);}
