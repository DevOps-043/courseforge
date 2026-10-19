import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentRouteErrorResponse } from "@/domains/production/bundle-agent/route-contract";
import { assertHtmlSlideImportRole, saveImportedSlidePackage } from "@/domains/production/slides/import/imported-slide-catalog.service";
import { analyzeImportedSlideHtml, importedDesignPreview, normalizeImportedSlideDesign } from "@/domains/production/slides/import/imported-slide-design.service";
import { htmlSlideImportRequestSchema, HtmlSlideImportError, HTML_SLIDE_IMPORT_LIMITS } from "@/domains/production/slides/import/imported-slide-design.contract";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const context = await resolveBundleAgentAuthContext();
    if (context.platformRole !== "ADMIN" && context.platformRole !== "SUPERADMIN") return apiErrorResponse({
      code: API_ERROR_CODE.roleForbidden, message: "Se requiere acceso de administrador para importar plantillas.", requestId, status: 403,
    });
    assertHtmlSlideImportRole(context.platformRole);
    const parsed = await parseJsonRequest(request, htmlSlideImportRequestSchema, HTML_SLIDE_IMPORT_LIMITS.sourceBytes * 2);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
      message: parsed.reason === "too_large" ? "La importación excede el tamaño permitido." : "La solicitud de importación no es válida.",
      requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    if (parsed.data.action === "analyze") {
      const result = analyzeImportedSlideHtml(parsed.data.html);
      return apiSuccessResponse({ ...result, previews: result.design.layouts.map((_layout, index) => importedDesignPreview(result.design, index)) }, { requestId });
    }
    if (parsed.data.action === "load") {
      const { data, error } = await context.admin.from("soflia_bundle_specs").select("spec_json")
        .eq("conversation_id", parsed.data.conversationId).eq("organization_id", context.organizationId)
        .order("version_number", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data?.spec_json?.importedDesign) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound,
        message: "La plantilla importada no existe en esta organización.", requestId, status: 404 });
      const design = normalizeImportedSlideDesign(data.spec_json.importedDesign);
      return apiSuccessResponse({ design, title: data.spec_json.title,
        report: { removedScripts: 0, removedResources: 0, warnings: ["Estás revisando una versión saneada. Guardar cambios crea otra versión en la biblioteca y conserva la anterior."] },
        previews: design.layouts.map((_layout, index) => importedDesignPreview(design, index)) }, { requestId });
    }
    const result = await saveImportedSlidePackage(context, parsed.data.title, parsed.data.design);
    return apiSuccessResponse(result, { requestId, status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof HtmlSlideImportError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: 422 });
    return bundleAgentRouteErrorResponse({ component: "admin.slides.templates.import", error, requestId });
  }
}
