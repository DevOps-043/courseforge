import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { buildAssemblyBrandingSnapshot, resolveAssemblyBranding } from "@/domains/production/composition-editor/composition-branding.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Resolves and freezes approved organization branding for a single draft. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const branding = await resolveAssemblyBranding({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const { error } = await authorization.admin
      .from("video_composition_draft_branding")
      .upsert({
        draft_id: draftId,
        organization_id: authorization.organizationId,
        intro_asset_id: branding.intro?.id || null,
        intro_snapshot: branding.intro ? buildAssemblyBrandingSnapshot(branding.intro) : null,
        intro_source: branding.introSource,
        outro_asset_id: branding.outro?.id || null,
        outro_snapshot: branding.outro ? buildAssemblyBrandingSnapshot(branding.outro) : null,
        resolved_at: new Date().toISOString(),
        resolved_by: authorization.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "draft_id" });
    if (error) throw error;
    return NextResponse.json({ success: true, data: branding });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    console.error("[CompositionBranding] Could not resolve branding", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "No se pudo resolver la configuración de intro y outro." }, { status: 500 });
  }
}

async function authorize() {
  const client = await createClient();
  const user = await getAuthenticatedUser(client);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  if (!(await canReviewContent(user.userId, tenant))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
