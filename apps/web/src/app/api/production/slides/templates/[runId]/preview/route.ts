import { z } from "zod";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentRouteErrorResponse } from "@/domains/production/bundle-agent/route-contract";
import { hydrateImportedDesignForOrganization } from "@/domains/production/slides/import/imported-slide-bundle-assets.server";
import { importedDesignPreview, normalizeImportedSlideDesign } from "@/domains/production/slides/import/imported-slide-design.service";
import { HtmlSlideImportError, IMPORT_PREVIEW_CSP } from "@/domains/production/slides/import/imported-slide-design.contract";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const context = await resolveBundleAgentAuthContext();
    const runId = z.string().uuid().parse((await params).runId);
    const { data: run, error } = await context.admin.from("soflia_bundle_generation_runs").select("spec_id")
      .eq("id", runId).eq("organization_id", context.organizationId).eq("status", "PACKAGED").maybeSingle();
    if (error) throw error;
    const { data: spec, error: specError } = run ? await context.admin.from("soflia_bundle_specs").select("spec_json")
      .eq("id", run.spec_id).eq("organization_id", context.organizationId).maybeSingle() : { data: null, error: null };
    if (specError) throw specError;
    if (!spec?.spec_json?.importedDesign) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound,
      message: "Plantilla no encontrada para esta organización.", requestId, status: 404 });
    const design = await hydrateImportedDesignForOrganization(normalizeImportedSlideDesign(spec.spec_json.importedDesign), context);
    return new Response(importedDesignPreview(design, 0), { headers: { "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": IMPORT_PREVIEW_CSP, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof HtmlSlideImportError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: 422 });
    return bundleAgentRouteErrorResponse({ component: "production.slides.templates.preview", error, requestId });
  }
}
