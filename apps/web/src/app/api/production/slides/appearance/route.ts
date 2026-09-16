import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import { renderCourseDeckHtml } from "@/domains/production/slides/render/html-deck-renderer.service";
import { courseDeckSpecSchema } from "@/domains/production/slides/specs/course-deck.schema";
import { normalizeProductionAssetStoragePath } from "@/domains/production/validation/open-design-html-rasterizer.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";

const STORAGE_BUCKET = "production-assets";
const APPEARANCE_VARIABLES_MARKER = "soflia-appearance-variables:v1";
const MAX_SLIDES_APPEARANCE_REQUEST_BYTES = 4 * 1024;
const requestSchema = z.object({
  appearance: z.enum(["light", "dark"]),
  componentId: z.string().uuid(),
}).strict();

function applyAppearanceAttribute(html: string, appearance: "light" | "dark") {
  return html.replace(
    /<html\b([^>]*?)\sdata-appearance=("|')[^"']*("|')([^>]*)>/i,
    `<html$1 data-appearance="${appearance}"$4>`,
  );
}

function renderLegacyDeckWithAppearance(rawSpec: unknown, appearance: "light" | "dark") {
  const parsed = courseDeckSpecSchema.safeParse(rawSpec);
  if (!parsed.success) return null;
  return {
    html: renderCourseDeckHtml({ ...parsed.data, appearance }),
    preparedSpec: { ...parsed.data, appearance },
  };
}

/** Switches an existing deck between built-in CSS palettes without invoking generation services. */
export async function PATCH(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.slides.appearance", { correlationId: requestId });
  try {
    const parsed = await parseJsonRequest(request, requestSchema, MAX_SLIDES_APPEARANCE_REQUEST_BYTES);
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Payload inválido para cambiar la apariencia de slides.",
        requestId,
        status: parsed.reason === "too_large" ? 413 : 400,
      });
    }
    const payload = parsed.data;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para cambiar la apariencia de slides.", requestId, status: 403 });
    }

    const authorized = await getAuthorizedMaterialComponentAdmin(payload.componentId);
    if (!authorized) return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Componente no encontrado para esta empresa.", requestId, status: 404 });

    const currentAssets = (authorized.component.assets || {}) as MaterialAssets;
    const currentSlides = currentAssets.slides;
    if (!currentSlides?.html_content_path) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "No hay HTML de slides para cambiar su apariencia.", requestId, status: 409 });
    }

    const storagePath = normalizeProductionAssetStoragePath(currentSlides.html_content_path);
    const { data: htmlBlob, error: downloadError } = await authorized.admin.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);
    if (downloadError || !htmlBlob) {
      throw new Error(`No se pudo leer el HTML de slides: ${downloadError?.message || "archivo no encontrado"}`);
    }

    const currentHtml = await htmlBlob.text();
    const legacyDeck = currentHtml.includes(APPEARANCE_VARIABLES_MARKER)
      ? null
      : renderLegacyDeckWithAppearance(currentSlides.prepared_spec, payload.appearance);
    if (!currentHtml.includes(APPEARANCE_VARIABLES_MARKER) && !legacyDeck) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "Este deck no contiene variables de apariencia ni un spec reutilizable. Genera el HTML una vez para actualizarlo.", requestId, status: 409 });
    }

    const nextHtml = legacyDeck?.html || applyAppearanceAttribute(currentHtml, payload.appearance);
    const { error: uploadError } = await authorized.admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, nextHtml, {
        cacheControl: "0",
        contentType: "text/html",
        upsert: true,
      });
    if (uploadError) throw new Error(`No se pudo actualizar el HTML de slides: ${uploadError.message}`);

    const publicUrl = authorized.admin.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const { animated_deck: _staleAnimatedDeck, ...slidesWithoutAnimatedDeck } = currentSlides;
    const preparedSpec = legacyDeck?.preparedSpec || (() => {
      const parsed = courseDeckSpecSchema.safeParse(currentSlides.prepared_spec);
      return parsed.success ? { ...parsed.data, appearance: payload.appearance } : currentSlides.prepared_spec;
    })();
    const assetsPatch: Partial<MaterialAssets> = {
      final_video_assembly_stale: true,
      production_status: "DECK_READY",
      slides_url: publicUrl,
      slides: {
        ...slidesWithoutAnimatedDeck,
        appearance: payload.appearance,
        html_content_path: `${STORAGE_BUCKET}/${storagePath}`,
        html_public_url: publicUrl,
        prepared_spec: preparedSpec as Record<string, unknown>,
      },
      updated_at: new Date().toISOString(),
    };
    const { data: assets, error: updateError } = await authorized.admin.rpc(
      "patch_material_component_assets",
      { p_assets_patch: assetsPatch, p_component_id: payload.componentId },
    );
    if (updateError) throw new Error(`No se pudo guardar la apariencia de slides: ${updateError.message}`);

    return apiSuccessResponse({ assets }, { requestId });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Payload inválido para cambiar la apariencia de slides.", requestId, status: 400 });
    }
    logger.error("production.slides.appearance_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo cambiar la apariencia de slides.", requestId, retryable: true, status: 500 });
  }
}
