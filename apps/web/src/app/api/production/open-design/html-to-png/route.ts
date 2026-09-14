import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import {
  normalizeProductionAssetStoragePath,
  rasterizeStoredOpenDesignHtmlSlides,
} from "@/domains/production/validation/open-design-html-rasterizer.service";

export const runtime = "nodejs";
export const maxDuration = 120;

import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HTML_TO_PNG_REQUEST_BYTES = 8 * 1024;
const requestSchema = z.object({
  componentId: z.string().uuid(),
  htmlContentPath: z.string().trim().min(1).max(2_048).optional(),
}).strict();

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.open_design.html_to_png", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, requestSchema, MAX_HTML_TO_PNG_REQUEST_BYTES);
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud para transformar slides no es válida.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const { componentId, htmlContentPath } = parsed.data;

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorizedComponent) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
    }

    const currentAssets = authorizedComponent.component.assets || {};
    const rawHtmlPath = htmlContentPath || currentAssets.slides?.html_content_path;
    if (!rawHtmlPath) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "No hay HTML de slides para transformar.", requestId, status: 409 });
    }

    let normalizedHtmlPath: string;
    try {
      normalizedHtmlPath = normalizeProductionAssetStoragePath(rawHtmlPath);
    } catch {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La ruta del HTML de slides no es válida.", requestId, status: 400 });
    }
    const result = await rasterizeStoredOpenDesignHtmlSlides({
      admin: authorizedComponent.admin,
      componentId,
      htmlStoragePath: normalizedHtmlPath,
    });

    const {
      html_content_path: _htmlContentPath,
      html_public_url: _htmlPublicUrl,
      ...slidesWithoutHtmlSource
    } = currentAssets.slides || {};
    const updatedSlides = {
      ...slidesWithoutHtmlSource,
      images: result.images,
    };
    const assetsPatch = {
      slides: updatedSlides,
      slides_url: result.images[0]?.public_url || currentAssets.slides_url || "",
      updated_at: new Date().toISOString(),
    };

    const { data: updatedAssets, error: updateError } = await authorizedComponent.admin.rpc(
      "patch_material_component_assets",
      { p_component_id: componentId, p_assets_patch: assetsPatch },
    );

    if (updateError) {
      logger.error("production.open_design.html_to_png_persist_failed", updateError, { componentId });
      return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar la transformación de slides.", requestId, retryable: true, status: 500 });
    }

    return apiSuccessResponse({
      assets: updatedAssets,
      slideImages: result.images,
      cleanup: result.cleanup,
    }, { requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La solicitud para transformar slides no es válida.", requestId, status: 400 });
    }
    logger.error("production.open_design.html_to_png_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo transformar el HTML a PNG.", requestId, retryable: true, status: 500 });
  }
}
