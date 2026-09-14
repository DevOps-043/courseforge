import { NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getLiaDBContext, generateDBContextSummary } from "@/lib/lia-db-context";
import {
  callGeminiREST,
  detectHallucination,
  getLiaSettings,
  parseActionFromResponse,
} from "@/lib/lia-api";
import {
  buildComputerUseResponse,
  buildConversationPrompt,
  buildHallucinationOverrideResponse,
  buildLiaConfig,
  buildSystemInstruction,
  cleanStandardResponse,
  extractGroundingSources,
} from "@/lib/lia-route-helpers";
import type { LiaRequestPayload } from "@/lib/lia-types";
import {
  getGeminiApiKey,
} from "@/lib/server/env";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";

const LIA_RATE_LIMIT = 30;
const LIA_RATE_WINDOW_SECONDS = 60;
const MAX_LIA_REQUEST_BYTES = 8 * 1024 * 1024;
const liaRequestSchema = z.object({
  actionResult: z.string().max(20_000).optional(),
  computerUseMode: z.boolean().optional(),
  domMap: z.string().max(100_000).optional(),
  messages: z.array(z.object({
    role: z.string().min(1).max(30),
    content: z.string().max(20_000),
  })).min(1).max(50),
  screenshot: z.string().max(7_000_000).optional(),
  url: z.string().url().max(2_000).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const correlationId = resolveCorrelationId(req.headers.get("x-request-id"));
  const logger = createOperationalLogger("lia.api", { correlationId });
  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId: correlationId, status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant?.organizationId) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId: correlationId, status: 403 });
    }

    const admin = getServiceRoleClient();
    const { data: rateLimitRows, error: rateLimitError } = await admin.rpc(
      "consume_api_rate_limit",
      {
        p_limit: LIA_RATE_LIMIT,
        p_rate_key: `lia:${tenant.organizationId}:${authenticatedUser.userId}`,
        p_window_seconds: LIA_RATE_WINDOW_SECONDS,
      },
    );
    if (rateLimitError) {
      logger.error("lia.rate_limit.unavailable", rateLimitError);
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: "Servicio temporalmente no disponible.", requestId: correlationId, retryable: true, status: 503 });
    }
    const rateLimit = Array.isArray(rateLimitRows) ? rateLimitRows[0] : null;
    if (!rateLimit?.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(rateLimit?.reset_at || Date.now()).getTime() - Date.now()) / 1000),
      );
      return apiErrorResponse({
        code: API_ERROR_CODE.rateLimited,
        headers: { "Retry-After": String(retryAfter) },
        message: "Demasiadas solicitudes. Intenta nuevamente en un momento.",
        requestId: correlationId,
        retryable: true,
        status: 429,
      });
    }

    const parsedPayload = await parseJsonRequest(req, liaRequestSchema, MAX_LIA_REQUEST_BYTES);
    if (!parsedPayload.success) {
      return apiErrorResponse({
        code: parsedPayload.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedPayload.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud inválida.",
        requestId: correlationId,
        status: parsedPayload.reason === "too_large" ? 413 : 400,
      });
    }
    const payload: LiaRequestPayload = parsedPayload.data;
    const useComputerUse = Boolean(payload.computerUseMode && payload.screenshot);
    const organizationId = tenant.organizationId;
    const settings = await getLiaSettings(supabase, useComputerUse, organizationId);
    const modelName = settings.model_name;
    const config = buildLiaConfig(settings, useComputerUse);
    const apiKey = getGeminiApiKey();
    logger.info("lia.request.started", {
      mode: useComputerUse ? "COMPUTER" : "STANDARD",
      model: modelName,
      messageCount: payload.messages.length,
    });

    let dbContextSummary = "";
    if (useComputerUse) {
      try {
        const dbContext = await getLiaDBContext(supabase, organizationId);
        dbContextSummary = generateDBContextSummary(dbContext);
      } catch (error) {
        logger.warn("lia.db_context.fallback_used", { error });
      }
    }

    const systemInstruction = buildSystemInstruction(
      useComputerUse,
      payload.domMap,
      dbContextSummary,
    );
    const fullPrompt = buildConversationPrompt(payload, systemInstruction);
    const result = await callGeminiREST(apiKey, modelName, fullPrompt, config, correlationId);
    const responseText = result.text;
    const groundingMetadata = result.groundingMetadata;

    if (useComputerUse) {
      const parsed = parseActionFromResponse(responseText);
      if (parsed) {
        const hallucinationCheck = detectHallucination(
          parsed.cleanText,
          payload.domMap,
        );

        if (
          hallucinationCheck.isHallucinating &&
          payload.domMap &&
          hallucinationCheck.searchTerm
        ) {
          logger.warn("lia.hallucination_override.applied");

          const overrideResponse = buildHallucinationOverrideResponse(
            payload.domMap,
            hallucinationCheck.searchTerm,
          );

          if (overrideResponse) {
            return apiSuccessResponse(overrideResponse, { requestId: correlationId });
          }
        }

        const responseData = buildComputerUseResponse(parsed);
        logger.info("lia.request.completed", { durationMs: Date.now() - startedAt });
        return apiSuccessResponse(responseData, { requestId: correlationId });
      }
    }

    const sources = extractGroundingSources(groundingMetadata);
    const cleanContent = cleanStandardResponse(responseText);
    logger.info("lia.request.completed", {
      durationMs: Date.now() - startedAt,
      sourceCount: sources.length,
    });

    return apiSuccessResponse({
      message: {
        role: "model",
        content: cleanContent,
        timestamp: new Date().toISOString(),
        sources: sources.length > 0 ? sources : undefined,
      },
    }, { requestId: correlationId });
  } catch (error: unknown) {
    logger.error("lia.request.failed", error, { durationMs: Date.now() - startedAt });
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      message: "No se pudo procesar la solicitud de Lia.",
      requestId: correlationId,
      retryable: true,
      status: 500,
    });
  }
}
