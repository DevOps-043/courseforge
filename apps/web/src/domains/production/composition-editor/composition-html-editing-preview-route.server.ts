import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";
import { htmlEditingInspectorEnabled } from "./composition-html-editing-inspector-http-policy";
import { resolveHtmlPreviewOperatorConfiguration } from "./composition-html-editing-preview-configuration.server";
import { createHtmlPreviewPageHandler } from "./http/composition-html-editing-preview-page-handler.server";

/** Server-owned response choice. Both routes use the same authority, quotas,
 * operator configuration and exact snapshot issuer; no choice in caller input. */
export function createConfiguredHtmlPreviewHandler(responseKind: "PAGE" | "RESOURCE_RENEWAL") {
  return createHtmlPreviewPageHandler({ responseKind,
    enabled: () => htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED),
    authenticate: async () => {
      const user = await getAuthenticatedUser(await createClient());
      return { actorId: user?.userId ?? null, tenant: user ? await resolveActiveTenantContext() : null };
    },
    serviceClient: getServiceRoleClient,
    configuration: () => ({ ...resolveHtmlPreviewOperatorConfiguration({ encodedKey: process.env.COMPOSITION_HTML_EDITING_PREVIEW_DELIVERY_KEY,
      audience: process.env.COMPOSITION_HTML_EDITING_PREVIEW_PARENT_ORIGIN, storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL }),
      runtimeWebRoot: process.cwd() }),
    logFailure: requestId => createOperationalLogger("production.html_preview.page", { correlationId: requestId })
      .warn("production.html_preview.page_unavailable", { reason: "SAFE_PREVIEW_PAGE_UNAVAILABLE" }),
  });
}
