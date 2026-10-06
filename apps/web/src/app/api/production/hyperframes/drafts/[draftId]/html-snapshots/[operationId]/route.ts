import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { htmlSnapshotRecoveryEnabled } from "@/domains/production/composition-editor/composition-html-editing-snapshot-recovery-policy";
import { createHtmlSnapshotRecoveryHandler } from "@/domains/production/composition-editor/http/composition-html-snapshot-recovery-handler.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{draftId:string;operationId:string}>};
const handle = createHtmlSnapshotRecoveryHandler({
  enabled:() => htmlSnapshotRecoveryEnabled(process.env.COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED),
  authenticate:async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId:user?.userId ?? null,tenant:user ? await resolveActiveTenantContext() : null};
  },
  serviceClient:getServiceRoleClient,
  logFailure:requestId => createOperationalLogger("production.html_snapshot.recovery",{correlationId:requestId})
    .warn("production.html_snapshot.recovery_unavailable",{reason:"SAFE_READ_UNAVAILABLE"}),
});
/** Opt-in read only. No archive source/URLs, writes, activation or render. */
export async function GET(request:Request,context:Context) {return handle(request,await context.params);}
