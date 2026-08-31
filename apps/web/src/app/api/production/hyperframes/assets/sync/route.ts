import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HyperframesSourceAssetError,
  syncHyperframesSourceAssetsFromProduction,
} from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { getHeygenClientForOrganization } from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenScenesService } from "@/domains/production/providers/heygen/heygen-scenes.service";
import { createClient } from "@/utils/supabase/server";

const inputSchema = z.object({ componentId: z.string().uuid() }).strict();

/** Synchronizes assets from the preceding Production step; it never moves or deletes files. */
export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json().catch(() => ({})));
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return NextResponse.json({ error: "No tienes permisos para preparar assets de video." }, { status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
    const admin = getServiceRoleClient();
    const heygenPendingClipCount = await refreshPendingHeygenClips({
      admin,
      componentId: input.componentId,
      organizationId: tenant.organizationId,
      userId: user.userId,
    });
    const synchronizedAssets = await syncHyperframesSourceAssetsFromProduction({
      componentId: input.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    return NextResponse.json({
      success: true,
      data: { ...synchronizedAssets, heygenPendingClipCount },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Component ID inválido." }, { status: 400 });
    if (error instanceof HyperframesSourceAssetError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API /production/hyperframes/assets/sync] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudieron preparar los assets del paso de Producción." }, { status: 500 });
  }
}

async function refreshPendingHeygenClips(params: {
  admin: ReturnType<typeof getServiceRoleClient>;
  componentId: string;
  organizationId: string;
  userId: string;
}) {
  const recoveryService = new HeygenScenesService(params.admin);
  await recoveryService.recoverCompletedSceneAssets({
    componentId: params.componentId,
    organizationId: params.organizationId,
  });

  try {
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: params.organizationId,
      supabase: params.admin,
    });
    const recovery = await new HeygenScenesService(params.admin, auth.client).recoverHistoricalSceneAssets({
      componentId: params.componentId,
      createdBy: params.userId,
      organizationId: params.organizationId,
    });
    console.info("[Hyperframes assets sync] Historical HeyGen reconciliation completed", {
      componentId: params.componentId,
      event: "heygen_scene_assets_reconciled",
      matchedJobCount: recovery.report.matchedJobCount,
      pendingAvatarCount: recovery.report.pendingAvatarCount,
      pendingExpectedMediaCount: recovery.report.pendingExpectedMediaCount,
      recoveredAvatarCount: recovery.report.recoveredAvatarCount,
      unconfiguredSceneCount: recovery.report.unconfiguredSceneCount,
      unresolvedSceneCount: recovery.report.unresolvedSceneCount,
    });
    return recovery.report.pendingAvatarCount;
  } catch (refreshError) {
    // Asset sync remains usable for already imported media. A transient HeyGen
    // lookup must not prevent the editor from opening.
    console.warn("[Hyperframes assets sync] Pending HeyGen clips could not be refreshed:", {
      componentId: params.componentId,
      message: getErrorMessage(refreshError),
    });
  }

  const { data: component, error } = await params.admin
    .from("material_components")
    .select("assets")
    .eq("id", params.componentId)
    .maybeSingle();
  if (error) throw error;
  const assets = component?.assets && typeof component.assets === "object"
    ? component.assets as Record<string, unknown>
    : {};
  const avatarClips = Array.isArray(assets.avatar_clips)
    ? assets.avatar_clips
    : [];
  return avatarClips.filter((clip) => (
    clip && typeof clip === "object"
    && (clip as Record<string, unknown>).status === "WAITING_PROVIDER"
  )).length;
}
