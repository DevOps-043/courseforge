import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { getCloudStorageService } from "@/domains/production/cloud-storage/cloud-storage.service";
import {
  isCloudStorageProvider,
  type ProductionAssetType,
} from "@/domains/production/cloud-storage/types";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  isHtmlSlideSource,
  rasterizeStoredOpenDesignHtmlSlides,
} from "@/domains/production/validation/open-design-html-rasterizer.service";

interface ImportRequestBody {
  accessToken?: string;
  avatarGenerationMode?: "scene_clips" | "single_video";
  componentId?: string;
  fileIdOrUrl?: string;
  provider?: unknown;
  type?: ProductionAssetType;
  urlOrId?: string;
}

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
  try {
    const body = (await request.json()) as ImportRequestBody;
    const fileIdOrUrl = body.fileIdOrUrl || body.urlOrId;
    const { type, componentId, accessToken } = body;

    if (!isCloudStorageProvider(body.provider)) {
      return NextResponse.json({ error: "Proveedor cloud invalido" }, { status: 400 });
    }

    if (!fileIdOrUrl || !type || !componentId) {
      return NextResponse.json(
        { error: "Faltan parametros: fileIdOrUrl, type y componentId son requeridos" },
        { status: 400 },
      );
    }

    const allowedTypes = new Set(["voice", "music", "broll", "avatar", "slides"]);
    if (!allowedTypes.has(type)) {
      return NextResponse.json({ error: "El tipo de activo provisto no es valido" }, { status: 400 });
    }

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json({ error: "Empresa no valida o no autorizada." }, { status: 403 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorizedComponent) {
      return NextResponse.json({ error: "Componente no encontrado para esta empresa" }, { status: 404 });
    }

    const admin = authorizedComponent.admin;
    const result = await getCloudStorageService(body.provider).importFile(
      fileIdOrUrl,
      type,
      componentId,
      authenticatedUser.userId,
      tenant.organizationId,
      accessToken,
    );

    const currentAssets = authorizedComponent.component.assets || {};
    const updatedAssets = { ...currentAssets };

    switch (type) {
      case "voice":
        updatedAssets.voice_audio = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          file_name: result.fileName,
          provider: "custom",
          last_uploaded_at: new Date().toISOString(),
        };
        break;
      case "music":
        updatedAssets.background_music = {
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
        updatedAssets.b_roll_clips = [
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
          updatedAssets.avatar_generation_mode = "scene_clips";
          updatedAssets.avatar_clips = [
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

        updatedAssets.avatar_generation_mode = "single_video";
        updatedAssets.avatar_video = {
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
        updatedAssets.slides = {
          ...(hasRenderableSlides ? slidesWithoutHtmlSource : currentAssets.slides),
          ...(hasRenderableSlides
            ? {}
            : {
                html_public_url: result.publicUrl,
                html_content_path: result.storagePath,
              }),
          images: nextImages,
        };
        updatedAssets.slides_url = nextImages[0]?.public_url || result.publicUrl;
        break;
      }
    }

    updatedAssets.updated_at = new Date().toISOString();

    const { error: updateError } = await admin
      .from("material_components")
      .update({ assets: updatedAssets })
      .eq("id", componentId);

    if (updateError) {
      console.error("[API /cloud-storage/import] DB update error:", updateError);
      return NextResponse.json(
        { error: "No se pudo actualizar el registro del componente en la base de datos" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      publicUrl: result.publicUrl,
      storagePath: result.storagePath,
      assets: updatedAssets,
    });
  } catch (error: unknown) {
    console.error("[API /cloud-storage/import] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno al importar del proveedor cloud" },
      { status: 500 },
    );
  }
}
