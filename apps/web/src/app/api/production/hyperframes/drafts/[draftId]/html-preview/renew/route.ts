import { createConfiguredHtmlPreviewHandler } from "@/domains/production/composition-editor/composition-html-editing-preview-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createConfiguredHtmlPreviewHandler("RESOURCE_RENEWAL");
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handle(request, await context.params);
}
