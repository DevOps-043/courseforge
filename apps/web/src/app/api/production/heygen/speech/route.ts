import crypto from "node:crypto";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  assertSafeHeygenAudioUrl,
  downloadHeygenAudioWithLimits,
} from "@/domains/production/providers/heygen/heygen-audio-import.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import {
  assertHeygenTextInputWithinLimits,
  HeygenRequestValidationError,
} from "@/domains/production/providers/heygen/heygen-request-constraints";
import {
  HeygenVideoService,
  HeygenVideoServiceError,
} from "@/domains/production/providers/heygen/heygen-video.service";
import { heygenGenerateVoiceoverRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { heygenCredentialErrorResponse, heygenProviderErrorResponse, heygenServiceErrorResponse } from "@/lib/server/heygen-route-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HEYGEN_SPEECH_REQUEST_BYTES = 128 * 1024;

/** Generates TTS with HeyGen's audio-only endpoint. No avatar video is submitted. */
export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.heygen.speech", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, heygenGenerateVoiceoverRequestSchema, MAX_HEYGEN_SPEECH_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload inválido para voz en off.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsedRequest.data;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para generar voz en off.", requestId, status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });

    if (payload.componentId) {
      const authorized = await getAuthorizedMaterialComponentAdmin(payload.componentId);
      if (!authorized) {
        return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
      }
      const auth = await getHeygenClientForOrganization({
        allowGlobalFallback: false,
        organizationId: tenant.organizationId,
        supabase: authorized.admin,
      });
      const service = new HeygenVideoService(authorized.admin, auth.client);
      const data = await service.createVoiceoverForComponent({
        componentContent: authorized.component.content,
        componentType: authorized.component.type || "VIDEO_THEORETICAL",
        createdBy: user.userId,
        fallbackTitle: null,
        options: {
          componentId: payload.componentId,
          inputType: payload.inputType,
          language: payload.language,
          locale: payload.locale,
          speed: payload.speed,
          voicePresetId: payload.voicePresetId,
        },
        organizationId: tenant.organizationId,
      });
      return apiSuccessResponse({
        data: {
          ...data,
          providerJobId: data.voiceAsset.providerRequestId,
          standalone: false,
        },
      }, { requestId });
    }

    const script = payload.script!;
    assertHeygenTextInputWithinLimits({ label: "El texto de voz en off", text: script });
    const admin = getServiceRoleClient();
    const repository = new HeygenRepository(admin);
    const voice = await repository.getVoicePresetForGeneration({
      organizationId: tenant.organizationId,
      presetId: payload.voicePresetId,
    });
    if (!voice?.heygen_voice_id) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Selecciona una voz HeyGen válida.", requestId, status: 400 });
    }
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const speech = await auth.client.generateSpeech({
      input_type: payload.inputType,
      language: payload.language,
      locale: payload.locale,
      speed: payload.speed,
      text: script,
      voice_id: voice.heygen_voice_id,
    });
    assertSafeHeygenAudioUrl(speech.audioUrl);
    const downloaded = await downloadHeygenAudioWithLimits({ url: speech.audioUrl });
    const providerRequestId = speech.requestId || crypto.randomUUID();
    const safeRequestId = providerRequestId.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 120) || crypto.randomUUID();
    const objectPath = `heygen/standalone/${tenant.organizationId}/${safeRequestId}.${downloaded.extension}`;
    const { error: uploadError } = await admin.storage
      .from("production-assets")
      .upload(objectPath, downloaded.buffer, {
        cacheControl: "31536000",
        contentType: downloaded.contentType,
        upsert: true,
      });
    if (uploadError) throw uploadError;
    const publicUrl = admin.storage.from("production-assets").getPublicUrl(objectPath).data.publicUrl;
    const { data: standaloneAsset, error: assetError } = await admin
      .from("heygen_standalone_assets")
      .upsert({
        asset_type: "VOICE_AUDIO",
        created_by: user.userId,
        duration_seconds: speech.durationSeconds,
        metadata: {
          input_type: payload.inputType || "text",
          language: payload.language || null,
          locale: payload.locale || null,
          script,
          voice_preset_id: payload.voicePresetId,
          word_timestamps: speech.wordTimestamps,
        },
        mime_type: downloaded.contentType,
        organization_id: tenant.organizationId,
        provider_request_id: speech.requestId || null,
        public_url: publicUrl,
        storage_bucket: "production-assets",
        storage_path: objectPath,
        title: payload.title || "Voz en off",
      }, { onConflict: "organization_id,storage_bucket,storage_path" })
      .select("id")
      .single();
    if (assetError) throw assetError;
    return apiSuccessResponse({
      data: {
        jobId: providerRequestId,
        providerJobId: speech.requestId || null,
        standalone: true,
        status: "SUCCEEDED",
        title: payload.title || "Voz en off",
        voiceAsset: {
          durationSeconds: speech.durationSeconds,
          id: standaloneAsset.id,
          providerRequestId: speech.requestId || null,
          publicUrl,
          storagePath: `production-assets/${objectPath}`,
          wordTimestamps: speech.wordTimestamps,
        },
      },
    }, { requestId });
  } catch (error: unknown) {
    if (error instanceof HeygenVideoServiceError || error instanceof HeygenRequestValidationError) {
      return heygenServiceErrorResponse(error, requestId);
    }
    if (error instanceof HeygenCredentialResolverError) {
      return heygenCredentialErrorResponse(error, requestId);
    }
    if (error instanceof HeygenApiError) {
      return heygenProviderErrorResponse({ error, failureMessage: "HeyGen no pudo generar la voz en off.", requestId });
    }
    logger.error("production.heygen.speech.generate_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error interno al generar la voz en off.", requestId, retryable: true, status: 500 });
  }
}
