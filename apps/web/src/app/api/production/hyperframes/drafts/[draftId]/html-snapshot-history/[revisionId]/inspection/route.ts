import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlSnapshotInspectionHandler } from "@/domains/production/composition-editor/http/composition-html-editing-snapshot-inspection-handler.server";
import { htmlSnapshotHistoryEnabled } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history-http.contract";
import { readAuthorizedHtmlSnapshotInspection } from "@/domains/production/composition-editor/composition-html-editing-snapshot-inspection-read.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlSnapshotInspectionHandler({
  enabled: () => htmlSnapshotHistoryEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  }, serviceClient: getServiceRoleClient,
  read: (supabase, request, signal) => readAuthorizedHtmlSnapshotInspection({ supabase, request, signal,
    storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "" }),
  logFailure: requestId => createOperationalLogger("production.html_editing.snapshot_inspection", { correlationId: requestId })
    .warn("production.html_editing.snapshot_inspection_unavailable", { reason: "SAFE_ARCHIVE_INSPECTION_UNAVAILABLE" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string; revisionId: string }> }) {
  return handle(request, await context.params);
}
