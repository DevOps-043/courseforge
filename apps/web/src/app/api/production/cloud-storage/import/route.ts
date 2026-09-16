import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { getCloudStorageService } from "@/domains/production/cloud-storage/cloud-storage.service";
import { registerImportedHyperframesSourceAsset } from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  isHtmlSlideSource,
  rasterizeStoredOpenDesignHtmlSlides,
} from "@/domains/production/validation/open-design-html-rasterizer.service";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { mapExternalImportError } from "@/lib/server/external-import-error";
import { withExternalImportCapacity } from "@/lib/server/external-import-concurrency";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_CLOUD_IMPORT_REQUEST_BYTES = 32 * 1024;
const cloudImportSchema = z.object({
  accessToken: z.string().min(1).max(16_000).optional(),
  avatarGenerationMode: z.enum(["scene_clips", "single_video"]).optional(),
  componentId: z.string().uuid(),
  fileIdOrUrl: z.string().trim().min(1).max(4_000).optional(),
  provider: z.enum(["google_drive", "onedrive"]),
  type: z.enum(["voice", "music", "broll", "avatar", "slides"]),
  urlOrId: z.string().trim().min(1).max(4_000).optional(),
}).strict().refine((body) => Boolean(body.fileIdOrUrl || body.urlOrId), {
  message: "Se requiere fileIdOrUrl o urlOrId.",
});

function isRenderableSlideImage(params: {
  mimeType?: string;
  fileName?: string;
  publicUrl: string;
}) {
  const mimeType = params.mimeType?.toLowerCase() || "";
  const fileName = params.fileName?.toLowerCase() || params.publicUrl.toLowerCase();

  return (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "image/svg+xml" ||
    fileName.endsWith(".png") ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg") ||
    fileName.endsWith(".webp") ||
    fileName.endsWith(".svg")
  );
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.cloud_storage.import", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, cloudImportSchema, MAX_CLOUD_IMPORT_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud de importación inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const body = parsedRequest.data;
    const fileIdOrUrl = body.fileIdOrUrl || body.urlOrId!;
    const { type, componentId, accessToken } = body;

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorizedComponent) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
    }

    const admin = authorizedComponent.admin;
    const result = await withExternalImportCapacity(
      body.provider,
      () => getCloudStorageService(body.provider).importFile(
        fileIdOrUrl,
        type,
        componentId,
        authenticatedUser.userId,
        tenant.organizationId,
        accessToken,
      ),
      request.signal,
    );
    const productionAssetId = await registerImportedHyperframesSourceAsset({
      componentId,
      createdBy: authenticatedUser.userId,
      importedAsset: result,
      importType: type,
      organizationId: tenant.organizationId,
      provider: body.provider,
      supabase: admin,
    });

    const currentAssets = authorizedComponent.component.assets || {};
    const assetsPatch: Record<string, unknown> = {};

    switch (type) {
      case "voice": {
        const currentManualVoices = Array.isArray(currentAssets.manual_voice_clips)
          ? currentAssets.manual_voice_clips
          : [];
        assetsPatch.manual_voice_clips = [
          ...currentManualVoices,
          {
            id: productionAssetId || `${body.provider}-${Date.now()}`,
            order: currentManualVoices.length + 1,
            storage_path: result.storagePath,
            public_url: result.publicUrl,
            file_name: result.fileName,
            provider: body.provider,
            last_uploaded_at: new Date().toISOString(),
          },
        ];
        break;
      }
      case "music":
        assetsPatch.background_music = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          file_name: result.fileName,
          volume_multiplier: currentAssets.background_music?.volume_multiplier ?? 0.15,
        };
        break;
      case "broll": {
        const currentClips = Array.isArray(currentAssets.b_roll_clips)
          ? currentAssets.b_roll_clips
          : [];
        assetsPatch.b_roll_clips = [
          ...currentClips,
          {
            id: `${body.provider}-${Date.now()}`,
            storage_path: result.storagePath,
            public_url: result.publicUrl,
            file_name: result.fileName,
            order: currentClips.length + 1,
          },
        ];
        break;
      }
      case "avatar":
        if (body.avatarGenerationMode === "scene_clips") {
          const currentClips = Array.isArray(currentAssets.avatar_clips)
            ? currentAssets.avatar_clips
            : [];
          assetsPatch.avatar_generation_mode = "scene_clips";
          assetsPatch.avatar_clips = [
            ...currentClips,
            {
              id: `${body.provider}-${Date.now()}`,
              storage_path: result.storagePath,
              public_url: result.publicUrl,
              file_name: result.fileName,
              order: currentClips.length + 1,
              provider: "upload",
              script_text: result.fileName,
              status: "COMPLETED",
            },
          ];
          break;
        }

        assetsPatch.avatar_generation_mode = "single_video";
        assetsPatch.avatar_video = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          file_name: result.fileName,
          provider: "upload",
        };
        break;
      case "slides": {
        const currentImages = Array.isArray(currentAssets.slides?.images)
          ? currentAssets.slides.images
          : [];
        const importedImages = isRenderableSlideImage({
          mimeType: result.mimeType,
          fileName: result.fileName,
          publicUrl: result.publicUrl,
        })
          ? [
              {
                file_name: result.fileName,
                slide_index: currentImages.length + 1,
                storage_path: result.storagePath,
                public_url: result.publicUrl,
              },
            ]
          : [];
        const shouldRasterizeHtml =
          importedImages.length === 0 &&
          isHtmlSlideSource({
            mimeType: result.mimeType,
            fileName: result.fileName,
            publicUrl: result.publicUrl,
            storagePath: result.storagePath,
          });
        const rasterizedImages =
          shouldRasterizeHtml
            ? (
                await rasterizeStoredOpenDesignHtmlSlides({
                  admin,
                  componentId,
                  htmlStoragePath: result.storagePath,
                })
              ).images
            : [];
        const nextImages =
          importedImages.length > 0
            ? [...currentImages, ...importedImages]
            : rasterizedImages.length > 0
              ? rasterizedImages
              : currentImages;

        const {
          html_content_path: _htmlContentPath,
          html_public_url: _htmlPublicUrl,
          ...slidesWithoutHtmlSource
        } = currentAssets.slides || {};
        const hasRenderableSlides = importedImages.length > 0 || rasterizedImages.length > 0;
        assetsPatch.slides = {
          ...(hasRenderableSlides ? slidesWithoutHtmlSource : currentAssets.slides),
          ...(hasRenderableSlides
            ? {}
            : {
                html_public_url: result.publicUrl,
                html_content_path: result.storagePath,
              }),
          images: nextImages,
        };
        assetsPatch.slides_url = nextImages[0]?.public_url || result.publicUrl;
        break;
      }
    }

    assetsPatch.updated_at = new Date().toISOString();

    const { data: updatedAssets, error: updateError } = await admin.rpc(
      "patch_material_component_assets",
      { p_component_id: componentId, p_assets_patch: assetsPatch },
    );

    if (updateError) {
      logger.error("production.cloud_storage.import.persistence_failed", updateError, { componentId });
      return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar el recurso importado.", requestId, retryable: true, status: 500 });
    }

    return apiSuccessResponse({
      publicUrl: result.publicUrl,
      storagePath: result.storagePath,
      productionAssetId,
      assets: updatedAssets,
    }, { requestId });
  } catch (error: unknown) {
    logger.error("production.cloud_storage.import.failed", error);
    const mapped = mapExternalImportError(error, "el proveedor cloud");
    return apiErrorResponse({
      ...mapped,
      headers: mapped.retryAfterSeconds ? { "Retry-After": String(mapped.retryAfterSeconds) } : undefined,
      requestId,
    });
  }
}
