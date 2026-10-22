import { z } from "zod";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentRouteErrorResponse } from "@/domains/production/bundle-agent/route-contract";
import { loadImportedTemplateBase } from "@/domains/production/slides/import/imported-template-base.service";
import { withImportedSlidePreviews } from "@/domains/production/slides/import/imported-slide-design.service";
import { apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const context = await resolveBundleAgentAuthContext();
    const runId = z.string().uuid().parse((await params).runId);
    const result = await loadImportedTemplateBase(context, runId);
    return apiSuccessResponse(withImportedSlidePreviews(result), { requestId, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return bundleAgentRouteErrorResponse({ component: "admin.slides.design-bases.load", error, requestId });
  }
}
