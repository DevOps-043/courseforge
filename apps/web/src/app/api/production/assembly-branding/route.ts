import { createHash } from "node:crypto";
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import {
  assemblyBrandingFinalizeSchema,
  assemblyBrandingSelectionSchema,
  parseAssemblyBrandingStoragePath,
} from "@/domains/production/assembly-branding/assembly-branding-upload";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import {
  createOperationalLogger,
  resolveCorrelationId,
} from "@/lib/server/operational-logger";

export const runtime = "nodejs";

const STORAGE_BUCKET = "production-assets";
const MAX_SELECTION_REQUEST_BYTES = 4 * 1024;
const MAX_FINALIZE_REQUEST_BYTES = 8 * 1024;

type AuthorizedAssemblyContext = {
  admin: ReturnType<typeof getServiceRoleClient>;
  organizationId: string;
  userId: string;
};

async function authorize(
  requestId: string,
): Promise<AuthorizedAssemblyContext | Response> {
  const client = await createClient();
  const user = await getAuthenticatedUser(client);
  if (!user) {
    return apiErrorResponse({
      code: API_ERROR_CODE.authRequired,
      message: "No autorizado.",
      requestId,
      status: 401,
    });
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return apiErrorResponse({
      code: API_ERROR_CODE.roleForbidden,
      message: "No tienes permisos para configurar identidad de ensamble.",
      requestId,
      status: 403,
    });
  }

  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    userId: user.userId,
  };
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.assembly_branding", {
    correlationId: requestId,
  });
  try {
    const auth = await authorize(requestId);
    if (auth instanceof Response) return auth;

    const [
      { data: assets, error: assetsError },
      { data: settings, error: settingsError },
    ] = await Promise.all([
      auth.admin
        .from("organization_assembly_assets")
        .select("id, kind, name, mime_type, file_size_bytes, duration_milliseconds, status, created_at")
        .eq("organization_id", auth.organizationId)
        .neq("status", "ARCHIVED")
        .order("created_at", { ascending: false }),
      auth.admin
        .from("organization_assembly_settings")
        .select("default_intro_asset_id, default_outro_asset_id, intro_enabled, outro_enabled")
        .eq("organization_id", auth.organizationId)
        .maybeSingle(),
    ]);
    if (assetsError || settingsError) throw assetsError || settingsError;

    return apiSuccessResponse(
      { data: { assets: assets || [], settings: settings || null } },
      { requestId },
    );
  } catch (error) {
    logger.error("assembly_branding.load_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      message: "No se pudo cargar la biblioteca de identidad.",
      requestId,
      retryable: true,
      status: 500,
    });
  }
}

export async function PUT(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.assembly_branding", {
    correlationId: requestId,
  });
  try {
    const auth = await authorize(requestId);
    if (auth instanceof Response) return auth;

    const parsedRequest = await parseJsonRequest(
      request,
      assemblyBrandingSelectionSchema,
      MAX_SELECTION_REQUEST_BYTES,
    );
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large"
          ? API_ERROR_CODE.payloadTooLarge
          : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large"
          ? "La selección excede el tamaño permitido."
          : "Selección inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }

    const { assetId, kind } = parsedRequest.data;
    if (assetId) {
      const { data, error } = await auth.admin
        .from("organization_assembly_assets")
        .select("id")
        .eq("id", assetId)
        .eq("organization_id", auth.organizationId)
        .eq("kind", kind)
        .eq("status", "APPROVED")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return apiErrorResponse({
          code: API_ERROR_CODE.invalidRequest,
          message: "El asset no pertenece a esta empresa o no está aprobado.",
          requestId,
          status: 400,
        });
      }
    }

    const field = kind === "INTRO" ? "default_intro_asset_id" : "default_outro_asset_id";
    const enabled = kind === "INTRO" ? "intro_enabled" : "outro_enabled";
    const { error } = await auth.admin
      .from("organization_assembly_settings")
      .upsert({
        organization_id: auth.organizationId,
        [field]: assetId,
        [enabled]: Boolean(assetId),
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id" });
    if (error) throw error;

    logger.info("assembly_branding.selection_updated", {
      assetId,
      kind,
      organizationId: auth.organizationId,
    });
    return apiSuccessResponse({}, { requestId });
  } catch (error) {
    logger.error("assembly_branding.selection_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      message: "No se pudo guardar la selección.",
      requestId,
      retryable: true,
      status: 500,
    });
  }
}

export async function PATCH(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.assembly_branding", {
    correlationId: requestId,
  });
  try {
    const auth = await authorize(requestId);
    if (auth instanceof Response) return auth;

    const parsedRequest = await parseJsonRequest(
      request,
      assemblyBrandingFinalizeSchema,
      MAX_FINALIZE_REQUEST_BYTES,
    );
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large"
          ? API_ERROR_CODE.payloadTooLarge
          : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large"
          ? "La finalización excede el tamaño permitido."
          : "Datos de finalización inválidos.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }

    const payload = parsedRequest.data;
    const pathInfo = parseAssemblyBrandingStoragePath(
      payload.path,
      auth.organizationId,
      payload.kind,
    );
    if (!pathInfo) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "La ruta de Storage no corresponde a esta empresa y tipo.",
        requestId,
        status: 400,
      });
    }
    const expectedExtension = payload.mimeType === "video/webm" ? "webm" : "mp4";
    if (pathInfo.extension !== expectedExtension) {
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "La extensión no corresponde al tipo de video.",
        requestId,
        status: 400,
      });
    }
    const { data: existing, error: existingError } = await auth.admin
      .from("organization_assembly_assets")
      .select("id, storage_path")
      .eq("id", pathInfo.id)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (existing.storage_path !== payload.path) {
        return apiErrorResponse({
          code: API_ERROR_CODE.conflict,
          message: "El asset ya fue finalizado con datos diferentes.",
          requestId,
          status: 409,
        });
      }
      return apiSuccessResponse({ data: { id: existing.id } }, { requestId });
    }

    const removeRejectedObject = async () => {
      const { error } = await auth.admin.storage.from(STORAGE_BUCKET).remove([payload.path]);
      if (error) logger.error("assembly_branding.rejected_upload_cleanup_failed", error, { path: payload.path });
    };

    const { data: objectInfo, error: objectInfoError } = await auth.admin.storage
      .from(STORAGE_BUCKET)
      .info(payload.path);
    if (objectInfoError || !objectInfo) {
      return apiErrorResponse({
        code: API_ERROR_CODE.resourceNotFound,
        message: "El video subido no existe o aún no está disponible.",
        requestId,
        retryable: true,
        status: 404,
      });
    }
    if (objectInfo.size !== payload.fileSizeBytes || objectInfo.contentType !== payload.mimeType) {
      await removeRejectedObject();
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "El objeto subido no coincide con el tamaño o tipo declarado.",
        requestId,
        status: 400,
      });
    }
    const checksum = createHash("sha256")
      .update(`${objectInfo.version}:${objectInfo.etag || "no-etag"}:${objectInfo.size}`)
      .digest("hex");

    const { data: signedRead, error: signedReadError } = await auth.admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(payload.path, 60);
    if (signedReadError || !signedRead?.signedUrl) throw signedReadError;

    const input = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(signedRead.signedUrl, {
        getRetryDelay: (attempts) => attempts < 2 ? attempts + 1 : null,
        maxCacheSize: 8 * 1024 * 1024,
        parallelism: 1,
      }),
    });
    let duration: number;
    let hasAudio: boolean;
    let sourceHeight: number;
    let sourceWidth: number;
    try {
      const [audioTrack, videoTrack] = await Promise.all([
        input.getPrimaryAudioTrack(),
        input.getPrimaryVideoTrack(),
      ]);
      if (!videoTrack) {
        await removeRejectedObject();
        return apiErrorResponse({
          code: API_ERROR_CODE.invalidRequest,
          message: "El objeto subido no contiene una pista de video válida.",
          requestId,
          status: 400,
        });
      }
      const [metadataDuration, height, width] = await Promise.all([
        input.getDurationFromMetadata(),
        videoTrack.getDisplayHeight(),
        videoTrack.getDisplayWidth(),
      ]);
      duration = metadataDuration ?? await input.computeDuration([videoTrack]);
      hasAudio = audioTrack !== null;
      sourceHeight = Number.isFinite(height) ? height : 0;
      sourceWidth = Number.isFinite(width) ? width : 0;
    } finally {
      input.dispose();
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      await removeRejectedObject();
      return apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message: "No se pudo medir la duración del video subido.",
        requestId,
        status: 400,
      });
    }

    const { error: insertError } = await auth.admin
      .from("organization_assembly_assets")
      .insert({
        id: pathInfo.id,
        organization_id: auth.organizationId,
        kind: payload.kind,
        name: payload.name.trim().slice(0, 160),
        storage_bucket: STORAGE_BUCKET,
        storage_path: payload.path,
        mime_type: payload.mimeType,
        file_size_bytes: objectInfo.size,
        duration_milliseconds: Math.round(duration * 1000),
        checksum,
        metadata: {
          file_name: payload.name,
          has_audio: hasAudio,
          source_height: sourceHeight || null,
          source_width: sourceWidth || null,
          checksum_source: "storage-version-etag-size",
          upload_mode: "signed-direct",
        },
        status: "APPROVED",
        created_by: auth.userId,
        approved_by: auth.userId,
        approved_at: new Date().toISOString(),
      });
    if (insertError) throw insertError;

    logger.info("assembly_branding.direct_upload_finalized", {
      assetId: pathInfo.id,
      bytes: objectInfo.size,
      kind: payload.kind,
      organizationId: auth.organizationId,
    });
    return apiSuccessResponse({ data: { id: pathInfo.id } }, { requestId, status: 201 });
  } catch (error) {
    logger.error("assembly_branding.direct_upload_finalize_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      message: "No se pudo finalizar el video de identidad.",
      requestId,
      retryable: true,
      status: 500,
    });
  }
}
