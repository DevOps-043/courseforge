import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { createHtmlReconstructionLibraryHandler } from "@/domains/production/composition-editor/http/composition-html-editing-reconstruction-library-handler.server";
import { htmlReconstructionOpeningEnabled } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.contract";
import { readAuthorizedHtmlReconstructionLibrary } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-library.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlReconstructionLibraryHandler({enabled: () => htmlReconstructionOpeningEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null};
  }, serviceClient: getServiceRoleClient,
  read: (supabase, request, signal) => readAuthorizedHtmlReconstructionLibrary({supabase, request, signal}),
  logFailure: requestId => createOperationalLogger("production.html_editing.reconstruction_library", {correlationId: requestId})
    .warn("production.html_editing.reconstruction_library_unavailable", {reason: "SAFE_LIBRARY_UNAVAILABLE"}),
});
export async function GET(request: Request, context: {params: Promise<{draftId: string}>}) {return handle(request, await context.params);}
