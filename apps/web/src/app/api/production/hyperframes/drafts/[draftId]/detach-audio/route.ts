import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  listHyperframesSourceAssets,
  syncHyperframesSourceAssetsFromProduction,
} from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { createClient } from "@/utils/supabase/server";

const requestSchema = z.object({
  componentId: z.string().uuid(),
  durationSeconds: z.number().positive().max(86_400),
  fileName: z.string().trim().min(1).max(180),
  sourceAssetId: z.string().uuid(),
  sourceClipId: z.string().trim().min(1).max(128),
  storagePath: z.string().trim().min(1).max(500),
}).strict();

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Registers an editor-produced audio derivative and links it to the active draft. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return NextResponse.json({ error: "No tienes permisos para separar audio." }, { status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
    const { draftId } = await context.params;
    const parsedDraftId = z.string().uuid().parse(draftId);
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const expectedPrefix = `editor-audio/${payload.componentId}/`;
    if (!payload.storagePath.startsWith(expectedPrefix) || payload.storagePath.includes("..") || payload.storagePath.includes("\\")) {
      return NextResponse.json({ error: "La ruta del audio separado no es válida." }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: draft, error: draftError } = await admin
      .from("video_composition_drafts")
      .select("composition_id")
      .eq("id", parsedDraftId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft?.composition_id) return NextResponse.json({ error: "Borrador de edición no encontrado." }, { status: 404 });
    const { data: composition, error: compositionError } = await admin
      .from("video_compositions")
      .select("material_component_id")
      .eq("id", draft.composition_id)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (compositionError) throw compositionError;
    if (composition?.material_component_id !== payload.componentId) {
      return NextResponse.json({ error: "El borrador no pertenece al componente indicado." }, { status: 403 });
    }
    const { data: sourceLink, error: sourceLinkError } = await admin
      .from("video_composition_draft_assets")
      .select("production_asset_id")
      .eq("draft_id", parsedDraftId)
      .eq("production_asset_id", payload.sourceAssetId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (sourceLinkError) throw sourceLinkError;
    if (!sourceLink) return NextResponse.json({ error: "El video fuente no pertenece al borrador." }, { status: 404 });
    const { data: sourceAsset, error: sourceAssetError } = await admin
      .from("production_assets")
      .select("mime_type")
      .eq("id", payload.sourceAssetId)
      .eq("organization_id", tenant.organizationId)
      .eq("material_component_id", payload.componentId)
      .maybeSingle();
    if (sourceAssetError) throw sourceAssetError;
    if (!sourceAsset?.mime_type?.startsWith("video/")) {
      return NextResponse.json({ error: "El asset fuente no es un video separable." }, { status: 400 });
    }

    const fullStoragePath = `production-assets/${payload.storagePath}`;
    const { data: component, error: componentError } = await admin
      .from("material_components")
      .select("assets")
      .eq("id", payload.componentId)
      .maybeSingle();
    if (componentError) throw componentError;
    if (!component) return NextResponse.json({ error: "Componente no encontrado." }, { status: 404 });
    const assets = isRecord(component.assets) ? component.assets : {};
    const existing = Array.isArray(assets.detached_audio_clips) ? assets.detached_audio_clips : [];
    const nextReference = {
      content_type: "audio/wav",
      detached_from_asset_id: payload.sourceAssetId,
      detached_from_clip_id: payload.sourceClipId,
      duration: payload.durationSeconds,
      file_name: payload.fileName,
      has_audio: true,
      public_url: null,
      storage_path: fullStoragePath,
    };
    const deduplicated = existing.filter((entry) => !isRecord(entry) || (
      entry.storage_path !== fullStoragePath
      && (entry.detached_from_asset_id !== payload.sourceAssetId || entry.detached_from_clip_id !== payload.sourceClipId)
    ));
    const { error: patchError } = await admin.rpc("patch_material_component_assets", {
      p_assets_patch: { detached_audio_clips: [...deduplicated, nextReference], updated_at: new Date().toISOString() },
      p_component_id: payload.componentId,
    });
    if (patchError) throw patchError;

    await syncHyperframesSourceAssetsFromProduction({
      componentId: payload.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const candidates = await listHyperframesSourceAssets({
      componentId: payload.componentId,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const detachedAsset = candidates.find((asset) => asset.storagePath === fullStoragePath);
    if (!detachedAsset) throw new Error("No se pudo registrar el audio separado.");
    const { error: linkError } = await admin.from("video_composition_draft_assets").upsert({
      draft_id: parsedDraftId,
      organization_id: tenant.organizationId,
      production_asset_id: detachedAsset.productionAssetId,
      role: "VOICE",
      source_reference: "PRODUCTION_MEDIA",
    }, { onConflict: "draft_id,production_asset_id" });
    if (linkError) throw linkError;
    return NextResponse.json({ success: true, data: detachedAsset });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Solicitud inválida." }, { status: 400 });
    }
    console.error("[API /production/hyperframes/drafts/:id/detach-audio] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo registrar el audio separado." }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
