import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  normalizeProductionAssetStoragePath,
} from "@/domains/production/validation/open-design-html-rasterizer.service";
import {
  collectAnimatedDeckRemoteAssetUrls,
  prepareAnimatedDeckForRemotion,
  rewriteAnimatedDeckRemoteAssetUrls,
  type AnimatedDeckRemoteAsset,
} from "@/domains/production/validation/animated-deck-preprocessor.service";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "production-assets";
const MAX_REMOTE_ASSETS = 24;
const MAX_REMOTE_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_ASSETS_TOTAL_BYTES = 48 * 1024 * 1024;
const REMOTE_ASSET_TIMEOUT_MS = 15_000;
const MINIMAL_PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type AuthorizedMaterialComponent = NonNullable<
  Awaited<ReturnType<typeof getAuthorizedMaterialComponentAdmin>>
>;

interface PrepareAnimatedDeckRequestBody {
  componentId?: string;
  htmlContentPath?: string;
}

function deckStoragePrefix(componentId: string) {
  return `slides/${componentId}/animated-deck`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeSourceAssetUrl(rawUrl: string) {
  return rawUrl.replace(/&amp;/g, "&");
}

function getImageExtension(contentType: string, sourceUrl: string) {
  const normalizedContentType = contentType.toLowerCase().split(";")[0].trim();
  if (normalizedContentType === "image/jpeg" || normalizedContentType === "image/jpg") return "jpg";
  if (normalizedContentType === "image/png") return "png";
  if (normalizedContentType === "image/webp") return "webp";
  if (normalizedContentType === "image/gif") return "gif";

  const pathname = (() => {
    try {
      return new URL(sourceUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const ext = pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1];
  return ext ? ext.replace("jpeg", "jpg") : null;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildMissingImagePlaceholder(sourceUrl: string, reason: string) {
  const host = (() => {
    try {
      return new URL(normalizeSourceAssetUrl(sourceUrl)).hostname;
    } catch {
      return "asset remoto";
    }
  })();
  const label = escapeXml(host);
  const message = escapeXml(reason);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img" aria-label="Imagen no disponible">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#071316"/>
      <stop offset="1" stop-color="#102a31"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect x="140" y="140" width="1640" height="800" rx="44" fill="none" stroke="#00d4b3" stroke-width="6" stroke-dasharray="22 22" opacity="0.75"/>
  <circle cx="960" cy="470" r="86" fill="#00d4b3" opacity="0.16"/>
  <path d="M904 520l88-112 136 174H792l72-92 40 30z" fill="#00d4b3" opacity="0.72"/>
  <text x="960" y="690" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700" fill="#e8fffb">Imagen externa no disponible</text>
  <text x="960" y="760" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" fill="#9adbd2">${label}</text>
  <text x="960" y="815" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#6fb8b0">${message}</text>
</svg>`;

  try {
    const sharpModule = await import("sharp");
    return await sharpModule.default(Buffer.from(svg, "utf8")).png().toBuffer();
  } catch {
    return Buffer.from(MINIMAL_PLACEHOLDER_PNG, "base64");
  }
}

async function uploadAnimatedDeckAsset(params: {
  admin: AuthorizedMaterialComponent["admin"];
  buffer: Buffer;
  contentType: string;
  sourceUrl: string;
  storagePath: string;
  status: AnimatedDeckRemoteAsset["status"];
  fallbackReason?: string;
}) {
  const { error: uploadError } = await params.admin.storage
    .from(BUCKET)
    .upload(params.storagePath, params.buffer, {
      contentType: params.contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`No se pudo guardar asset remoto del deck: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = params.admin.storage.from(BUCKET).getPublicUrl(params.storagePath);

  return {
    bytes: params.buffer.byteLength,
    content_type: params.contentType,
    fallback_reason: params.fallbackReason,
    public_url: publicUrl,
    source_url: params.sourceUrl,
    status: params.status,
    storage_path: `${BUCKET}/${params.storagePath}`,
  } satisfies AnimatedDeckRemoteAsset;
}

async function importAnimatedDeckRemoteAssets(params: {
  admin: AuthorizedMaterialComponent["admin"];
  componentId: string;
  urls: string[];
}): Promise<{ assets: AnimatedDeckRemoteAsset[]; urlMap: Record<string, string> }> {
  if (params.urls.length > MAX_REMOTE_ASSETS) {
    throw new Error(`El deck referencia demasiados assets remotos (${params.urls.length}).`);
  }

  let totalBytes = 0;
  const assets: AnimatedDeckRemoteAsset[] = [];
  const urlMap: Record<string, string> = {};
  const prefix = `${deckStoragePrefix(params.componentId)}/assets`;

  for (const [index, sourceUrl] of params.urls.entries()) {
    const normalizedUrl = normalizeSourceAssetUrl(sourceUrl);
    let url: URL;
    try {
      url = new URL(normalizedUrl);
    } catch {
      throw new Error(`URL remota invalida en deck animado: ${sourceUrl}`);
    }

    if (url.protocol !== "https:") {
      throw new Error(`Solo se permiten assets remotos HTTPS en deck animado: ${sourceUrl}`);
    }

    let buffer: Buffer;
    let extension = "png";
    let uploadContentType = "image/png";
    let status: AnimatedDeckRemoteAsset["status"] = "imported";
    let fallbackReason: string | undefined;

    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(REMOTE_ASSET_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const resolvedExtension = getImageExtension(contentType, normalizedUrl);
      if (!resolvedExtension || !contentType.toLowerCase().startsWith("image/")) {
        throw new Error(`tipo no permitido: ${contentType || "desconocido"}`);
      }

      const contentLengthHeader = response.headers.get("content-length");
      const expectedBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : 0;
      if (expectedBytes > MAX_REMOTE_ASSET_BYTES) {
        throw new Error("supera limite individual");
      }

      buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_REMOTE_ASSET_BYTES) {
        throw new Error("supera limite individual");
      }

      extension = resolvedExtension;
      uploadContentType = contentType.split(";")[0].trim() || `image/${extension}`;
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "descarga fallida";
      status = "placeholder";
      buffer = await buildMissingImagePlaceholder(sourceUrl, fallbackReason);
      console.warn(
        `[animated-deck/prepare] Reemplazando asset remoto por placeholder: ${sourceUrl} (${fallbackReason})`,
      );
    }

    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REMOTE_ASSETS_TOTAL_BYTES) {
      throw new Error("Los assets remotos del deck exceden el limite total permitido.");
    }

    const storagePath = `${prefix}/asset-${pad2(index + 1)}.${extension}`;
    const importedAsset = await uploadAnimatedDeckAsset({
      admin: params.admin,
      buffer,
      contentType: uploadContentType,
      fallbackReason,
      sourceUrl,
      status,
      storagePath,
    });

    assets.push(importedAsset);
    urlMap[sourceUrl] = importedAsset.public_url;
  }

  return { assets, urlMap };
}

function buildFailedAnimatedDeck(params: {
  currentAssets: MaterialAssets;
  error: unknown;
  sourceHtmlPath: string;
}): NonNullable<NonNullable<MaterialAssets["slides"]>["animated_deck"]> {
  const message = params.error instanceof Error
    ? params.error.message
    : "No se pudo preparar el deck animado.";

  return {
    animated_slide_count: 0,
    cleanup_report: {},
    css: "",
    error_message: message,
    fonts: [],
    height: 1080,
    slide_count: 0,
    slides: [],
    source: "manual_upload",
    source_html_path: params.sourceHtmlPath,
    static_slide_count: 0,
    status: "FAILED",
    validation_report: {
      errors: [message],
      isValid: false,
    },
    width: 1920,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as PrepareAnimatedDeckRequestBody;
  const componentId = body.componentId;

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

  const currentAssets = (authorizedComponent.component.assets || {}) as MaterialAssets;
  const rawHtmlPath = body.htmlContentPath || currentAssets.slides?.html_content_path;
  if (!rawHtmlPath) {
    return NextResponse.json(
      { error: "No hay HTML de slides para preparar como deck animado" },
      { status: 400 },
    );
  }

  const normalizedHtmlPath = normalizeProductionAssetStoragePath(rawHtmlPath);
  const sourceHtmlPath = `${BUCKET}/${normalizedHtmlPath}`;

  try {
    const { data, error } = await authorizedComponent.admin.storage
      .from(BUCKET)
      .download(normalizedHtmlPath);

    if (error || !data) {
      throw new Error(`No se pudo descargar el HTML de slides: ${error?.message || "archivo no encontrado"}`);
    }

    const html = await data.text();
    const remoteUrls = collectAnimatedDeckRemoteAssetUrls(html);
    const importedAssets = await importAnimatedDeckRemoteAssets({
      admin: authorizedComponent.admin,
      componentId,
      urls: remoteUrls,
    });
    const htmlWithImportedAssets = rewriteAnimatedDeckRemoteAssetUrls(
      html,
      importedAssets.urlMap,
    );
    const prepared = prepareAnimatedDeckForRemotion(htmlWithImportedAssets, {
      allowedRemoteAssetUrls: importedAssets.assets.map((asset) => asset.public_url),
      remoteAssets: importedAssets.assets,
    });
    const prefix = deckStoragePrefix(componentId);
    const deckJsonPath = `${prefix}/deck.json`;

    const { error: deckUploadError } = await authorizedComponent.admin.storage
      .from(BUCKET)
      .upload(deckJsonPath, JSON.stringify(prepared.deck, null, 2), {
        contentType: "application/json",
        upsert: true,
      });

    if (deckUploadError) {
      throw new Error(`No se pudo guardar deck.json: ${deckUploadError.message}`);
    }

    const animatedDeck: NonNullable<NonNullable<MaterialAssets["slides"]>["animated_deck"]> = {
      animated_slide_count: prepared.animatedSlideCount,
      cleanup_report: { ...prepared.cleanup },
      css: prepared.css,
      deck_json_path: `${BUCKET}/${deckJsonPath}`,
      fonts: prepared.fonts,
      generated_at: new Date().toISOString(),
      height: prepared.deck.height,
      remote_assets: prepared.remoteAssets,
      slide_count: prepared.deck.slides.length,
      slides: prepared.deck.slides,
      source: "manual_upload",
      source_html_path: sourceHtmlPath,
      static_slide_count: prepared.staticSlideCount,
      status: "READY_FOR_RENDER",
      validation_report: { ...prepared.validation },
      width: prepared.deck.width,
    };
    const updatedAssets: MaterialAssets = {
      ...currentAssets,
      final_video_assembly_stale: true,
      slides: {
        ...(currentAssets.slides || {}),
        animated_deck: animatedDeck,
        html_content_path: sourceHtmlPath,
      },
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await authorizedComponent.admin
      .from("material_components")
      .update({ assets: updatedAssets })
      .eq("id", componentId);

    if (updateError) {
      throw new Error(`No se pudo actualizar el componente: ${updateError.message}`);
    }

    return NextResponse.json({
      success: true,
      animatedDeck,
      assets: updatedAssets,
    });
  } catch (error: unknown) {
    const failedDeck = buildFailedAnimatedDeck({
      currentAssets,
      error,
      sourceHtmlPath,
    });
    const failedAssets: MaterialAssets = {
      ...currentAssets,
      slides: {
        ...(currentAssets.slides || {}),
        animated_deck: failedDeck,
        html_content_path: sourceHtmlPath,
      },
      updated_at: new Date().toISOString(),
    };

    await authorizedComponent.admin
      .from("material_components")
      .update({ assets: failedAssets })
      .eq("id", componentId);

    console.error("[animated-deck/prepare] Unexpected error:", error);
    return NextResponse.json(
      {
        animatedDeck: failedDeck,
        error: failedDeck.error_message,
        success: false,
      },
      { status: 400 },
    );
  }
}
