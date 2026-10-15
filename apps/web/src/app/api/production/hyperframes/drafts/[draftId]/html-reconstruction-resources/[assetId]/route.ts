import { htmlReconstructionResourceRouteHandlers } from "@/domains/production/composition-editor/http/composition-html-editing-reconstruction-resource-route.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: {params: Promise<{draftId: string; assetId: string}>}) {
  return htmlReconstructionResourceRouteHandlers.lookup(request, await context.params);
}
