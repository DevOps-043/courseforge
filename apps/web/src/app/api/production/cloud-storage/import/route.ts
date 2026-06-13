import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { getCloudStorageService } from "@/domains/production/cloud-storage/cloud-storage.service";
import {
  isCloudStorageProvider,
  type ProductionAssetType,
} from "@/domains/production/cloud-storage/types";

interface ImportRequestBody {
  accessToken?: string;
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

    const admin = getServiceRoleClient();
    const result = await getCloudStorageService(body.provider).importFile(
      fileIdOrUrl,
      type,
      componentId,
      authenticatedUser.userId,
      accessToken,
    );

    const { data: component, error: fetchError } = await admin
      .from("material_components")
      .select("assets")
      .eq("id", componentId)
      .single();

    if (fetchError || !component) {
      return NextResponse.json({ error: "Componente no encontrado" }, { status: 404 });
    }

    const currentAssets = component.assets || {};
    const updatedAssets = { ...currentAssets };

    switch (type) {
      case "voice":
        updatedAssets.voice_audio = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          provider: "custom",
          last_uploaded_at: new Date().toISOString(),
        };
        break;
      case "music":
        updatedAssets.background_music = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
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
            order: currentClips.length + 1,
          },
        ];
        break;
      }
      case "avatar":
        updatedAssets.avatar_video = {
          storage_path: result.storagePath,
          public_url: result.publicUrl,
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
                slide_index: currentImages.length + 1,
                storage_path: result.storagePath,
                public_url: result.publicUrl,
              },
            ]
          : [];

        updatedAssets.slides = {
          ...currentAssets.slides,
          html_public_url: result.publicUrl,
          html_content_path: result.storagePath,
          images: importedImages.length > 0 ? [...currentImages, ...importedImages] : currentImages,
        };
        updatedAssets.slides_url = result.publicUrl;
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
