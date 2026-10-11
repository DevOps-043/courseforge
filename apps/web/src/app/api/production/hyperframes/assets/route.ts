import { readStandaloneHtmlLibrary } from "@/domains/production/standalone/standalone-timeline-library.service";
import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { listHyperframesSourceAssets } from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const componentIdSchema = z.string().uuid();

/** Lists existing, traceable media that an internal composition may reuse. */
export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.assets", { correlationId: requestId });
  try {
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId"),
    );
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para consultar assets de video.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    }
    const assets = await listHyperframesSourceAssets({
      componentId,
      organizationId: tenant.organizationId,
      supabase: getServiceRoleClient(),
    });
    const htmlClips = await readStandaloneHtmlLibrary({ componentId, organizationId: tenant.organizationId, supabase: getServiceRoleClient() });
    return apiSuccessResponse({ data: assets, htmlClips }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Component ID inválido.", requestId, status: 400 });
    }
    logger.error("production.hyperframes.assets.list_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron consultar los assets de video.", requestId, retryable: true, status: 500 });
  }
}
