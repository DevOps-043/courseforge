import { z } from "zod";
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
import {
  assertSafeExternalMediaUrl,
  readResponseWithLimit,
} from "@/domains/production/external-media-import-policy";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "production-assets";
const MAX_REMOTE_ASSETS = 24;
const MAX_REMOTE_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_ASSETS_TOTAL_BYTES = 48 * 1024 * 1024;
const REMOTE_ASSET_TIMEOUT_MS = 15_000;
const MAX_PREPARE_ANIMATED_DECK_REQUEST_BYTES = 8 * 1024;
const MINIMAL_PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type AuthorizedMaterialComponent = NonNullable<
  Awaited<ReturnType<typeof getAuthorizedMaterialComponentAdmin>>
>;

const requestSchema = z.object({
  componentId: z.string().uuid(),
  htmlContentPath: z.string().trim().min(1).max(2_048).optional(),
}).strict();

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
  logger: ReturnType<typeof createOperationalLogger>;
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
    let buffer: Buffer;
    let extension = "png";
    let uploadContentType = "image/png";
    let status: AnimatedDeckRemoteAsset["status"] = "imported";
    let fallbackReason: string | undefined;

    try {
      const url = await assertSafeExternalMediaUrl(normalizedUrl);
      const response = await fetch(url, {
        redirect: "error",
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

      buffer = await readResponseWithLimit(response, MAX_REMOTE_ASSET_BYTES);

      extension = resolvedExtension;
      uploadContentType = contentType.split(";")[0].trim() || `image/${extension}`;
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : "descarga fallida";
      status = "placeholder";
      buffer = await buildMissingImagePlaceholder(sourceUrl, fallbackReason);
      params.logger.warn("production.slides.animated_deck.remote_asset_replaced", {
        assetIndex: index,
        componentId: params.componentId,
        reason: fallbackReason,
      });
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
  const message = getSafeAnimatedDeckFailureMessage(params.error);

  return {
    animated_slide_count: 0,
    appearance: params.currentAssets.slides?.appearance || "light",
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

function getSafeAnimatedDeckFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return isUserCorrectableAnimatedDeckFailure(message)
    ? message
    : "No se pudo preparar el deck animado.";
}

function isUserCorrectableAnimatedDeckFailure(message: string) {
  const userCorrectable = [
    /^El deck referencia demasiados assets remotos/,
    /^Los assets remotos del deck exceden el limite total permitido/,
    /^La URL externa /,
    /^Solo se permiten assets remotos HTTPS/,
  ];
  return userCorrectable.some((pattern) => pattern.test(message));
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.slides.animated_deck", { correlationId: requestId });
  const parsed = await parseJsonRequest(request, requestSchema, MAX_PREPARE_ANIMATED_DECK_REQUEST_BYTES);
  if (!parsed.success) {
    return apiErrorResponse({
      code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
      message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La solicitud para preparar el deck animado no es válida.",
      requestId,
      status: parsed.reason === "too_large" ? 413 : 400,
    });
  }
  try {
  const body = parsed.data;
  const componentId = body.componentId;

  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
  }

  const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorizedComponent) {
    return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });
  }

  const currentAssets = (authorizedComponent.component.assets || {}) as MaterialAssets;
  const rawHtmlPath = body.htmlContentPath || currentAssets.slides?.html_content_path;
  if (!rawHtmlPath) {
    return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "No hay HTML de slides para preparar como deck animado.", requestId, status: 409 });
  }

  let normalizedHtmlPath: string;
  try {
    normalizedHtmlPath = normalizeProductionAssetStoragePath(rawHtmlPath);
  } catch {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "La ruta del HTML de slides no es válida.", requestId, status: 400 });
  }
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
      logger,
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
      appearance: prepared.deck.appearance,
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
    const assetsPatch: Partial<MaterialAssets> = {
      final_video_assembly_stale: true,
      slides: {
        ...(currentAssets.slides || {}),
        appearance: prepared.deck.appearance,
        animated_deck: animatedDeck,
        html_content_path: sourceHtmlPath,
      },
      updated_at: new Date().toISOString(),
    };

    const { data: updatedAssets, error: updateError } = await authorizedComponent.admin.rpc(
      "patch_material_component_assets",
      { p_component_id: componentId, p_assets_patch: assetsPatch },
    );

    if (updateError) {
      throw new Error(`No se pudo actualizar el componente: ${updateError.message}`);
    }

    return apiSuccessResponse({
      animatedDeck,
      assets: updatedAssets,
    }, { requestId });
  } catch (error: unknown) {
    const failedDeck = buildFailedAnimatedDeck({
      currentAssets,
      error,
      sourceHtmlPath,
    });
    const failedAssetsPatch: Partial<MaterialAssets> = {
      slides: {
        ...(currentAssets.slides || {}),
        animated_deck: failedDeck,
        html_content_path: sourceHtmlPath,
      },
      updated_at: new Date().toISOString(),
    };

    await authorizedComponent.admin.rpc(
      "patch_material_component_assets",
      { p_component_id: componentId, p_assets_patch: failedAssetsPatch },
    );

    logger.error("production.slides.animated_deck_prepare_failed", error, { componentId });
    const userCorrectable = isUserCorrectableAnimatedDeckFailure(
      error instanceof Error ? error.message : "",
    );
    return apiErrorResponse({
      code: userCorrectable ? API_ERROR_CODE.invalidRequest : API_ERROR_CODE.internalError,
      extensions: { animatedDeck: failedDeck },
      message: failedDeck.error_message || "No se pudo preparar el deck animado.",
      requestId,
      retryable: !userCorrectable,
      status: userCorrectable ? 400 : 500,
    });
  }
  } catch (error) {
    logger.error("production.slides.animated_deck_boundary_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo preparar el deck animado.", requestId, retryable: true, status: 500 });
  }
}
