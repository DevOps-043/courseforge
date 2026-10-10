import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlSnapshotHistoryHandler } from "@/domains/production/composition-editor/http/composition-html-editing-snapshot-history-handler.server";
import { htmlSnapshotHistoryEnabled } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history-http.contract";
import { readAuthorizedHtmlSnapshotHistory } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history.server";

// Separate namespace: a valid HTML clip may itself be named "history".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlSnapshotHistoryHandler({
  enabled: () => htmlSnapshotHistoryEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  }, serviceClient: getServiceRoleClient,
  read: (supabase, request, signal) => readAuthorizedHtmlSnapshotHistory({ supabase, request, signal }),
  logFailure: requestId => createOperationalLogger("production.html_editing.snapshot_history", { correlationId: requestId })
    .warn("production.html_editing.snapshot_history_unavailable", { reason: "SAFE_HISTORY_READ_UNAVAILABLE" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) { return handle(request, await context.params); }
