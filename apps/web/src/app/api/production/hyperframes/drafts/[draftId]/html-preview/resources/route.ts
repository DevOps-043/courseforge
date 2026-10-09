import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { createOperationalLogger } from "@/lib/server/operational-logger";
import { htmlEditingInspectorEnabled } from "@/domains/production/composition-editor/composition-html-editing-inspector-http-policy";
import { createHtmlPreviewResourceHandler } from "@/domains/production/composition-editor/http/composition-html-editing-preview-resource-handler.server";
import { resolveHtmlPreviewOperatorConfiguration } from "@/domains/production/composition-editor/composition-html-editing-preview-configuration.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createHtmlPreviewResourceHandler({
  enabled: () => htmlEditingInspectorEnabled(process.env.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED),
  configuration: () => resolveHtmlPreviewOperatorConfiguration({ encodedKey: process.env.COMPOSITION_HTML_EDITING_PREVIEW_DELIVERY_KEY,
    audience: process.env.COMPOSITION_HTML_EDITING_PREVIEW_PARENT_ORIGIN, storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL }),
  serviceClient: getServiceRoleClient,
  logFailure: requestId => createOperationalLogger("production.html_preview.resource", { correlationId: requestId })
    .warn("production.html_preview.resource_unavailable", { reason: "SAFE_RESOURCE_DELIVERY_UNAVAILABLE" }),
});
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handle(request, await context.params);
}
