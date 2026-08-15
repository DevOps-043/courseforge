import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ assetId: string; draftId: string }>; }

/** Redirects an authorized preview request to a short-lived Storage URL. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { assetId, draftId } = await context.params;
    const parsedDraftId = z.string().uuid().parse(draftId);
    const parsedAssetId = z.string().uuid().parse(assetId);
    const { data: link, error: linkError } = await authorization.admin
      .from("video_composition_draft_assets")
      .select("production_asset_id")
      .eq("draft_id", parsedDraftId)
      .eq("production_asset_id", parsedAssetId)
      .eq("organization_id", authorization.organizationId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return NextResponse.json({ error: "Asset de edición no encontrado." }, { status: 404 });

    const { data: asset, error: assetError } = await authorization.admin
      .from("production_assets")
      .select("storage_bucket, storage_path")
      .eq("id", parsedAssetId)
      .eq("organization_id", authorization.organizationId)
      .maybeSingle();
    if (assetError) throw assetError;
    if (!asset?.storage_bucket || !asset.storage_path) {
      return NextResponse.json({ error: "El asset no tiene storage disponible." }, { status: 404 });
    }
    const storagePath = toBucketRelativePath(asset.storage_bucket, asset.storage_path);
    const { data: signed, error: signedError } = await authorization.admin.storage
      .from(asset.storage_bucket)
      .createSignedUrl(storagePath, COMPOSITION_PREVIEW_ASSET_URL_TTL_SECONDS);
    if (signedError) throw signedError;
    return NextResponse.redirect(signed.signedUrl, {
      headers: { "Cache-Control": "private, no-store" },
      status: 302,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de asset inválido." }, { status: 400 });
    console.error("[API /production/hyperframes/drafts/:id/assets/:assetId] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo preparar el asset para el preview." }, { status: 500 });
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Ruta de asset insegura.");
  return path;
}
