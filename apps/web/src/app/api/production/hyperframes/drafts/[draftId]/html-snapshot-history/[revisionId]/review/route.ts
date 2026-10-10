import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlSnapshotRepublicationReviewHandler } from "@/domains/production/composition-editor/http/composition-html-editing-snapshot-republication-review-handler.server";
import { htmlSnapshotHistoryEnabled } from "@/domains/production/composition-editor/composition-html-editing-snapshot-history-http.contract";
import { readAuthorizedHtmlSnapshotRepublicationReview } from "@/domains/production/composition-editor/composition-html-editing-snapshot-republication-review.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlSnapshotRepublicationReviewHandler({
  enabled: () => htmlSnapshotHistoryEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
  }, serviceClient: getServiceRoleClient,
  read: (supabase, request, signal) => readAuthorizedHtmlSnapshotRepublicationReview({ supabase, request, signal,
    storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "" }),
  logFailure: requestId => createOperationalLogger("production.html_editing.snapshot_republication_review", { correlationId: requestId })
    .warn("production.html_editing.snapshot_republication_review_unavailable", { reason: "SAFE_REPUBLICATION_REVIEW_UNAVAILABLE" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string; revisionId: string }> }) {
  return handle(request, await context.params);
}
