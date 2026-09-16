import { z } from "zod";
import { ArtlistService } from "@/domains/production/providers/artlist.service";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { createClient } from "@/utils/supabase/server";

const artlistSearchQuerySchema = z.object({
  query: z.string().trim().max(200),
  type: z.enum(["music", "video"]),
}).strict();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.artlist.search", { correlationId: requestId });
  try {
    const searchParams = new URL(request.url).searchParams;
    const parsedQuery = artlistSearchQuerySchema.safeParse({
      query: searchParams.get("q") || "",
      type: searchParams.get("type"),
    });
    if (!parsedQuery.success) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: 'El parámetro "type" debe ser "music" o "video" y la búsqueda no puede exceder 200 caracteres.',
        requestId,
        status: 400,
      });
    }

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const results = await new ArtlistService().search(parsedQuery.data.query, parsedQuery.data.type);
    return apiSuccessResponse({ results }, { requestId });
  } catch (error: unknown) {
    logger.error("production.artlist.search.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al buscar en Artlist", requestId, retryable: true, status: 500 });
  }
}
