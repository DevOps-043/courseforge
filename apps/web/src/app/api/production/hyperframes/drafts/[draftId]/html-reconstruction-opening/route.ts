import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlReconstructionOpeningHandler } from "@/domains/production/composition-editor/http/composition-html-editing-reconstruction-opening-handler.server";
import { htmlReconstructionOpeningEnabled } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.contract";
import { readAuthorizedHtmlReconstructionOpening } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlReconstructionOpeningHandler({
  enabled: () => htmlReconstructionOpeningEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null};
  }, serviceClient: getServiceRoleClient,
  read: (supabase, request, signal) => readAuthorizedHtmlReconstructionOpening({supabase, request, signal}),
  logFailure: requestId => createOperationalLogger("production.html_editing.reconstruction_opening", {correlationId: requestId})
    .warn("production.html_editing.reconstruction_opening_unavailable", {reason: "SAFE_OPENING_UNAVAILABLE"}),
});
export async function GET(request: Request, context: {params: Promise<{draftId: string}>}) {return handle(request, await context.params);}
