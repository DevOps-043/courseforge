import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import {
  normalizeProductionAssetStoragePath,
} from "@/domains/production/validation/open-design-html-rasterizer.service";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { materialAssetsSchema } from "@/domains/materials/validators/assets.validators";

export const runtime = "nodejs";

const BUCKET = "production-assets";
const SLIDE_COMPONENT_PATH = /^slides\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[-/])/i;

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.slides.html_preview", { correlationId: requestId });
  try {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
  }

  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");
  if (!rawPath) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "path es requerido.", requestId, status: 400 });
  }

  let storagePath: string;
  try {
    storagePath = normalizeProductionAssetStoragePath(rawPath);
  } catch (error) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error instanceof Error ? error.message : "Ruta de HTML invalida.", requestId, status: 400 });
  }

  const componentId = storagePath.match(SLIDE_COMPONENT_PATH)?.[1];
  if (!componentId) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La ruta no identifica un componente válido.", requestId, status: 400 });
  }
  const authorized = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorized) {
    return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "HTML no encontrado.", requestId, status: 404 });
  }
  const assets = materialAssetsSchema.safeParse(authorized.component.assets);
  const registeredPath = assets.success && assets.data.slides?.html_content_path
    ? normalizeProductionAssetStoragePath(assets.data.slides.html_content_path)
    : null;
  if (registeredPath !== storagePath) {
    return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "HTML no encontrado.", requestId, status: 404 });
  }

  const { data, error } = await authorized.admin.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) {
    return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "HTML no encontrado.", requestId, status: 404 });
  }

  const html = await data.text();
  return new Response(html, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": [
        "default-src 'self' data: blob:",
        "img-src * data: blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "script-src 'unsafe-inline'",
      ].join("; "),
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "x-request-id": requestId,
    },
  });
  } catch (error) {
    logger.error("production.slides.html_preview_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar la vista previa de slides.", requestId, retryable: true, status: 500 });
  }
}
