import { getAuthenticatedUser, getServiceRoleClient } from "../../../../lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "../../../../lib/server/tenant-context";
import { createOperationalLogger } from "../../../../lib/server/operational-logger";
import { createClient } from "../../../../utils/supabase/server";
import { htmlReconstructionOpeningEnabled } from "../composition-html-editing-reconstruction-opening.contract";
import { htmlReconstructionResourceLinkEnabled } from "../composition-html-editing-reconstruction-resource-link.contract";
import { createHtmlReconstructionResourceHandlers } from "./composition-html-editing-reconstruction-resource-handlers.server";

export const htmlReconstructionResourceRouteHandlers = createHtmlReconstructionResourceHandlers({
  enabled: method => method === "GET" ? htmlReconstructionOpeningEnabled(process.env) : htmlReconstructionResourceLinkEnabled(process.env),
  authenticate: async () => {
    const user = await getAuthenticatedUser(await createClient());
    return {actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null};
  }, serviceClient: getServiceRoleClient,
  logFailure: requestId => createOperationalLogger("production.html_editing.reconstruction_resource", {correlationId: requestId})
    .warn("production.html_editing.reconstruction_resource_unconfirmed", {reason: "SAFE_RESOURCE_OPERATION_UNCONFIRMED"}),
});
