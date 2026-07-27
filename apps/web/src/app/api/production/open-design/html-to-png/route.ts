import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import {
  normalizeProductionAssetStoragePath,
  rasterizeStoredOpenDesignHtmlSlides,
} from "@/domains/production/validation/open-design-html-rasterizer.service";

export const runtime = "nodejs";
export const maxDuration = 120;

interface HtmlToPngRequestBody {
  componentId?: string;
  htmlContentPath?: string;
}

export async function POST(request: Request) {
  try {
    const { componentId, htmlContentPath } = (await request.json()) as HtmlToPngRequestBody;

    if (!componentId) {
      return NextResponse.json({ error: "componentId es requerido" }, { status: 400 });
    }

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorizedComponent) {
      return NextResponse.json(
        { error: "Componente no encontrado para esta empresa" },
        { status: 404 },
      );
    }

    const currentAssets = authorizedComponent.component.assets || {};
    const rawHtmlPath = htmlContentPath || currentAssets.slides?.html_content_path;
    if (!rawHtmlPath) {
      return NextResponse.json(
        { error: "No hay HTML de slides para transformar" },
        { status: 400 },
      );
    }

    const normalizedHtmlPath = normalizeProductionAssetStoragePath(rawHtmlPath);
    const result = await rasterizeStoredOpenDesignHtmlSlides({
      admin: authorizedComponent.admin,
      componentId,
      htmlStoragePath: normalizedHtmlPath,
    });

    const {
      html_content_path: _htmlContentPath,
      html_public_url: _htmlPublicUrl,
      ...slidesWithoutHtmlSource
    } = currentAssets.slides || {};
    const updatedSlides = {
      ...slidesWithoutHtmlSource,
      images: result.images,
    };
    const updatedAssets = {
      ...currentAssets,
      slides: updatedSlides,
      slides_url: result.images[0]?.public_url || currentAssets.slides_url || "",
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await authorizedComponent.admin
      .from("material_components")
      .update({ assets: updatedAssets })
      .eq("id", componentId);

    if (updateError) {
      console.error("[open-design/html-to-png] DB update error:", updateError);
      return NextResponse.json(
        { error: "No se pudo guardar la transformacion de slides" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      assets: updatedAssets,
      slideImages: result.images,
      cleanup: result.cleanup,
    });
  } catch (error: unknown) {
    console.error("[open-design/html-to-png] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno al transformar HTML a PNG" },
      { status: 500 },
    );
  }
}
