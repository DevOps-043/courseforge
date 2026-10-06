import { createHash } from "node:crypto";
import {getAuthenticatedUser,getServiceRoleClient} from "@/lib/server/artifact-action-auth";
import {resolveActiveTenantContext} from "@/lib/server/tenant-context";
import {createOperationalLogger} from "@/lib/server/operational-logger";
import {createClient} from "@/utils/supabase/server";
import {createHtmlSnapshotPublicationHandler} from "@/domains/production/composition-editor/http/composition-html-snapshot-publication-handler.server";
import {htmlSnapshotPublicationEnabled} from "@/domains/production/composition-editor/composition-html-snapshot-publication-http.contract";
import {readHtmlSnapshotExecutionConfiguration} from "@/domains/production/composition-editor/composition-html-snapshot-publication-configuration.server";
import {createHtmlEditingSnapshotHost} from "@/domains/production/composition-editor/composition-html-editing-snapshot-host.server";
import {readCompositionAnimationRuntime} from "@/domains/production/composition-editor/composition-preview-compiler.service";
import {getHyperframesRenderProfile,toHyperframesRenderSettings} from "@/domains/production/hyperframes/hyperframes-render-profiles";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{draftId:string}>};
const handle=createHtmlSnapshotPublicationHandler({
  enabled:() => htmlSnapshotPublicationEnabled(process.env.COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED)
    && process.env.COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED === "true",
  authenticate:async () => {
    const user=await getAuthenticatedUser(await createClient());
    return {actorId:user?.userId ?? null,tenant:user ? await resolveActiveTenantContext() : null};
  },
  serviceClient:getServiceRoleClient,
  publish:async (supabase,input) => {
    const renderExecution=readHtmlSnapshotExecutionConfiguration(process.env.COMPOSITION_HTML_SNAPSHOT_EXECUTION_CONTRACT_JSON);
    const host=createHtmlEditingSnapshotHost({supabase,supabaseUrl:process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""});
    input.signal.throwIfAborted();
    const animationRuntimeSha256=createHash("sha256").update(await readCompositionAnimationRuntime()).digest("hex");
    input.signal.throwIfAborted();
    return host.publishAuthorized({actorId:input.actorId,organizationId:input.organizationId,documentId:input.draftId,
      documentHash:input.documentHash,compositionId:input.compositionId,operationId:input.operationId,
      expectedActiveRevisionId:input.expectedActiveRevisionId,signal:input.signal,animationRuntimeSha256,renderExecution,
      renderProfile:toHyperframesRenderSettings(getHyperframesRenderProfile(input.renderProfileId))});
  },
  logFailure:requestId => createOperationalLogger("production.html_snapshot.publication",{correlationId:requestId})
    .warn("production.html_snapshot.publication_unconfirmed",{reason:"SAFE_PUBLICATION_UNCONFIRMED"}),
});
/** Opt-in snapshot registration only; does not issue render authority or run media processes. */
export async function POST(request:Request,context:Context) {return handle(request,await context.params);}
