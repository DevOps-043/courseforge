import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { readLegacyRevisionPreview } from "@/domains/production/composition-editor/composition-html-editing-legacy-preview-policy";

interface RouteContext { params: Promise<{ revisionId: string }>; }

/** Returns only compiler-generated preview HTML; rendering still uses the ZIP. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.revision.preview", { correlationId: requestId });
  try {
    const revisionId = z.string().uuid().parse((await context.params).revisionId);
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para previsualizar el video.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    const { data, error } = await getServiceRoleClient()
      .from("video_composition_revisions")
      // The revision already carries organization_id. Joining the composition
      // is ambiguous because the schema has more than one FK between these
      // tables, which made every preview request fail before HTML was read.
      .select("manifest")
      .eq("id", revisionId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (error) throw error;
    const preview = readLegacyRevisionPreview(data?.manifest);
    if (preview.kind === "html-editing-required") {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest,
        message: "Esta revisión HTML editable requiere un preview autorizado de snapshot; no está disponible mediante la ruta legacy.",
        requestId, retryable: false, status: 422 });
    }
    if (preview.kind === "unavailable") return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Preview de video no disponible.", requestId, status: 404 });
    return new NextResponse(preview.html, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src https: data:",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Revision ID inválido.", requestId, status: 400 });
    }
    logger.error("production.hyperframes.revision.preview_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el preview de video.", requestId, retryable: true, status: 500 });
  }
}
