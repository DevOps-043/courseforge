import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlHistoricalCandidateHandler } from "@/domains/production/composition-editor/http/composition-html-editing-historical-candidate-handler.server";
import { htmlSnapshotHistoryEnabled } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history-http.contract";
import { HistoricalHtmlPublicationRepository } from "@/domains/production/composition-editor/composition-html-editing-historical-publication-repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlHistoricalCandidateHandler({enabled: () => htmlSnapshotHistoryEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null};
  }, serviceClient: getServiceRoleClient,
  read: (client, request, signal) => new HistoricalHtmlPublicationRepository(client).readCandidate(request, signal),
  logFailure: requestId => createOperationalLogger("production.html_editing.historical_candidate", {correlationId: requestId})
    .warn("production.html_editing.historical_candidate_unavailable", {reason: "SAFE_HISTORICAL_CANDIDATE_UNAVAILABLE"}),
});
export async function GET(request: Request, context: {params: Promise<{draftId: string; candidateId: string}>}) {
  return handle(request, await context.params);
}
