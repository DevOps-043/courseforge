import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { GoogleDriveService } from "@/domains/production/providers/google-drive.service";
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

const MAX_GOOGLE_DRIVE_IMPORT_REQUEST_BYTES = 32 * 1024;
const googleDriveImportSchema = z.object({
  accessToken: z.string().min(1).max(16_000).optional(),
  componentId: z.string().uuid(),
  type: z.enum(["voice", "music", "broll", "avatar", "slides"]),
  urlOrId: z.string().trim().min(1).max(4_000),
}).strict();

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
  const logger = createOperationalLogger("production.google_drive.import", { correlationId: requestId });
  try {
    const parsedRequest = await parseJsonRequest(request, googleDriveImportSchema, MAX_GOOGLE_DRIVE_IMPORT_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Solicitud de importación inválida.",
        requestId,
        status: parsedRequest.reason === "too_large" ? 413 : 400,
      });
    }
    const { urlOrId, type, componentId, accessToken } = parsedRequest.data;

    // Authenticate User
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

    // Call GoogleDriveService to download from Drive and upload to Storage
    const driveService = new GoogleDriveService();
    const result = await withExternalImportCapacity(
      "google_drive",
      () => driveService.importFile(
        urlOrId,
        type,
        componentId,
        accessToken,
        authenticatedUser.userId,
        tenant.organizationId,
      ),
      request.signal,
    );
    const productionAssetId = await registerImportedHyperframesSourceAsset({
      componentId,
      createdBy: authenticatedUser.userId,
      importedAsset: result,
      importType: type,
      organizationId: tenant.organizationId,
      provider: "google_drive",
      supabase: admin,
    });

    const currentAssets = authorizedComponent.component.assets || {};
    const assetsPatch: Record<string, unknown> = {};

    // Update assets JSON structure depending on the asset type
    switch (type) {
      case "voice":
        assetsPatch.voice_audio = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          file_name: result.fileName,
          provider: "custom",
          last_uploaded_at: new Date().toISOString(),
        };
        break;
      case "music":
        assetsPatch.background_music = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          file_name: result.fileName,
          volume_multiplier: currentAssets.background_music?.volume_multiplier ?? 0.15,
        };
        break;
      case "broll": {
        const currentClips = Array.isArray(currentAssets.b_roll_clips) ? currentAssets.b_roll_clips : [];
        const newClip = {
          id: `drive-${Date.now()}`,
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          file_name: result.fileName,
          order: currentClips.length + 1,
        };
        assetsPatch.b_roll_clips = [...currentClips, newClip];
        break;
      }
      case "avatar":
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
        assetsPatch.slides_url = nextImages[0]?.public_url || result.publicUrl; // legacy fallback
        break;
      }
    }

    assetsPatch.updated_at = new Date().toISOString();

    const { data: updatedAssets, error: updateError } = await admin.rpc(
      "patch_material_component_assets",
      { p_component_id: componentId, p_assets_patch: assetsPatch },
    );

    if (updateError) {
      logger.error("production.google_drive.import.persistence_failed", updateError, { componentId });
      return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar el recurso importado.", requestId, retryable: true, status: 500 });
    }

    return apiSuccessResponse({
      publicUrl: result.publicUrl,
      storagePath: result.storagePath,
      productionAssetId,
      assets: updatedAssets,
    }, { requestId });
  } catch (error: unknown) {
    logger.error("production.google_drive.import.failed", error);
    const mapped = mapExternalImportError(error, "Google Drive");
    return apiErrorResponse({
      ...mapped,
      headers: mapped.retryAfterSeconds ? { "Retry-After": String(mapped.retryAfterSeconds) } : undefined,
      requestId,
    });
  }
}
