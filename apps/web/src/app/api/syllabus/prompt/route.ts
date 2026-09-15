import { SYLLABUS_PROMPT } from "@/domains/syllabus/config/syllabus.config";
import {
  getAuthenticatedUser,
  getAuthorizedArtifactAdminForTenant,
} from "@/lib/server/artifact-action-auth";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { SYLLABUS_PROMPT_CODE } from "@/shared/config/prompts/pipeline.prompts";
import { resolvePromptWithMetadata } from "@/shared/config/prompts/prompt-resolver.service";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("syllabus.prompt", {
    correlationId: requestId,
  });
  const artifactId = new URL(request.url).searchParams.get("artifactId") || "";

  if (!UUID_PATTERN.test(artifactId)) {
    return apiErrorResponse({
      code: API_ERROR_CODE.invalidRequest,
      message: "Identificador de artefacto inválido.",
      requestId,
      status: 400,
    });
  }

  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({
        code: API_ERROR_CODE.authRequired,
        message: "No autorizado.",
        requestId,
        status: 401,
      });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({
        code: API_ERROR_CODE.tenantForbidden,
        message: "Empresa no válida o no autorizada.",
        requestId,
        status: 403,
      });
    }

    const authorized = await getAuthorizedArtifactAdminForTenant(
      artifactId,
      tenant,
    );
    if (!authorized) {
      return apiErrorResponse({
        code: API_ERROR_CODE.resourceNotFound,
        message: "Artefacto no encontrado para esta empresa.",
        requestId,
        status: 404,
      });
    }

    const prompt = await resolvePromptWithMetadata(
      authorized.admin,
      SYLLABUS_PROMPT_CODE,
      SYLLABUS_PROMPT,
      tenant.organizationId,
    );

    return apiSuccessResponse({ prompt }, { requestId });
  } catch (error) {
    logger.error("syllabus.prompt_lookup_failed", error, { artifactId });
    return apiErrorResponse({
      code: API_ERROR_CODE.dependencyUnavailable,
      message: "No se pudo cargar temporalmente el prompt configurado.",
      requestId,
      retryable: true,
      status: 503,
    });
  }
}
