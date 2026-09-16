import crypto from "crypto";
import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HeygenApiError,
} from "@/domains/production/providers/heygen/heygen.client";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import {
  assertHeygenTextInputWithinLimits,
  buildResolutionRejectionHint,
  HEYGEN_MAX_TEXT_INPUT_CHARACTERS,
  HeygenRequestValidationError,
} from "@/domains/production/providers/heygen/heygen-request-constraints";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { heygenCredentialErrorResponse, heygenProviderErrorResponse, heygenServiceErrorResponse } from "@/lib/server/heygen-route-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_STANDALONE_VIDEO_REQUEST_BYTES = 128 * 1024;

const standaloneVideoRequestSchema = z
  .object({
    aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
    avatarPresetId: z.string().uuid().optional(),
    caption: z.boolean().default(false),
    engine: z.enum(["avatar_iv", "avatar_v"]).default("avatar_iv"),
    outputFormat: z.enum(["mp4", "webm"]).default("mp4"),
    resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"),
    script: z.string().trim().min(20).max(HEYGEN_MAX_TEXT_INPUT_CHARACTERS),
    title: z.string().trim().min(3).max(120),
    voicePresetId: z.string().uuid().optional(),
  })
  .strict();

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.standalone.videos", { correlationId: requestId });
  let requestedResolution: "720p" | "1080p" | "4k" = "1080p";
  try {
    const parsedRequest = await parseJsonRequest(request, standaloneVideoRequestSchema, MAX_HEYGEN_STANDALONE_VIDEO_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload invalido para generar video HeyGen standalone.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    requestedResolution = payload.resolution;
    assertHeygenTextInputWithinLimits({
      label: "El guion standalone",
      text: payload.script,
    });
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para generar videos con HeyGen.", requestId, status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada.", requestId, status: 403 });
    }

    const repository = new HeygenRepository(getServiceRoleClient());
    const avatar = await repository.getAvatarPresetForGeneration({
      organizationId: tenant.organizationId,
      presetId: payload.avatarPresetId,
    });
    if (!avatar) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "No hay avatar HeyGen disponible para esta empresa.", requestId, status: 400 });
    }

    const voice = payload.voicePresetId
      ? await repository.getVoicePresetForGeneration({
          organizationId: tenant.organizationId,
          presetId: payload.voicePresetId,
        })
      : null;
    const providerVoiceId = voice?.heygen_voice_id || avatar.default_voice_id;
    if (!providerVoiceId) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Selecciona una voz o marca una voz default para el avatar HeyGen.", requestId, status: 400 });
    }

    const admin = getServiceRoleClient();
    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const createdVideo = await heygenAuth.client.createAvatarVideo(
      {
        aspect_ratio: payload.aspectRatio,
        avatar_id: avatar.heygen_avatar_look_id,
        callback_id: `standalone-${tenant.organizationId}`,
        caption: payload.caption
          ? { file_format: "srt", style: "default" }
          : undefined,
        engine: { type: payload.engine },
        output_format: payload.outputFormat,
        resolution: payload.resolution,
        script: payload.script,
        title: payload.title,
        type: "avatar",
        voice_id: providerVoiceId,
      },
      `heygen-standalone-${tenant.organizationId}-${crypto.randomUUID()}`,
    );

    return apiSuccessResponse({
      data: {
        jobId: createdVideo.videoId,
        providerJobId: createdVideo.videoId,
        providerStatus: createdVideo.providerStatus || null,
        standalone: true,
        status: "WAITING_PROVIDER",
      },
    }, { requestId });
  } catch (error: unknown) {
    if (error instanceof HeygenRequestValidationError) {
      return heygenServiceErrorResponse(error, requestId);
    }

    if (error instanceof HeygenApiError) {
      return heygenProviderErrorResponse({
        error,
        failureMessage: "HeyGen no pudo generar el video standalone.",
        hint: buildResolutionRejectionHint(requestedResolution, error),
        requestId,
      });
    }

    if (error instanceof HeygenCredentialResolverError) {
      return heygenCredentialErrorResponse(error, requestId);
    }

    logger.error("production.heygen.standalone.video_generate_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno del servidor al generar video HeyGen standalone.", requestId, retryable: true, status: 500 });
  }
}
