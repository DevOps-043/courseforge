import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { GoogleDriveService } from "@/domains/production/providers/google-drive.service";

interface ImportRequestBody {
  urlOrId?: string;
  type?: "voice" | "music" | "broll" | "avatar" | "slides";
  componentId?: string;
  accessToken?: string;
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
    const { urlOrId, type, componentId, accessToken } = (await request.json()) as ImportRequestBody;

    if (!urlOrId || !type || !componentId) {
      return NextResponse.json(
        { error: "Faltan parámetros: urlOrId, type y componentId son requeridos" },
        { status: 400 }
      );
    }

    const allowedTypes = new Set(["voice", "music", "broll", "avatar", "slides"]);
    if (!allowedTypes.has(type)) {
      return NextResponse.json(
        { error: "El tipo de activo provisto no es válido" },
        { status: 400 }
      );
    }

    // Authenticate User
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    // Call GoogleDriveService to download from Drive and upload to Storage
    const driveService = new GoogleDriveService();
    const result = await driveService.importFile(urlOrId, type, componentId, accessToken);

    // Fetch current component assets
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

    // Update assets JSON structure depending on the asset type
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
        const currentClips = Array.isArray(currentAssets.b_roll_clips) ? currentAssets.b_roll_clips : [];
        const newClip = {
          id: `drive-${Date.now()}`,
          storage_path: result.storagePath,
          public_url: result.publicUrl,
          order: currentClips.length + 1,
        };
        updatedAssets.b_roll_clips = [...currentClips, newClip];
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
          images:
            importedImages.length > 0
              ? [...currentImages, ...importedImages]
              : currentImages,
        };
        updatedAssets.slides_url = result.publicUrl; // legacy fallback
        break;
      }
    }

    updatedAssets.updated_at = new Date().toISOString();

    // Update component assets in Supabase DB
    const { error: updateError } = await admin
      .from("material_components")
      .update({ assets: updatedAssets })
      .eq("id", componentId);

    if (updateError) {
      console.error("[API /google-drive/import] DB update error:", updateError);
      return NextResponse.json(
        { error: "No se pudo actualizar el registro del componente en la base de datos" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      publicUrl: result.publicUrl,
      storagePath: result.storagePath,
      assets: updatedAssets,
    });
  } catch (error: unknown) {
    console.error("[API /google-drive/import] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno al importar de Google Drive" },
      { status: 500 }
    );
  }
}
