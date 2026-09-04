import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { buildAssemblyBrandingSnapshot, reconcileAssemblyBrandingDocument, resolveAssemblyBranding } from "@/domains/production/composition-editor/composition-branding.service";
import { applyAndAppendCompositionDocumentPatches, CompositionDocumentError, getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }
const outroSelectionSchema = z.object({ outroAssetId: z.string().uuid().nullable() }).strict();

/** Reports only whether approved branding is available; Storage identity stays server-side. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const [branding, { data: outros, error: outrosError }, { data: selected, error: selectedError }] = await Promise.all([
      resolveAssemblyBranding({
        draftId,
        organizationId: authorization.organizationId,
        supabase: authorization.admin,
      }),
      authorization.admin.from("organization_assembly_assets").select("id, name, duration_milliseconds").eq("organization_id", authorization.organizationId).eq("kind", "OUTRO").eq("status", "APPROVED").order("created_at", { ascending: false }),
      authorization.admin.from("video_composition_draft_branding").select("outro_asset_id").eq("draft_id", draftId).eq("organization_id", authorization.organizationId).maybeSingle(),
    ]);
    if (outrosError || selectedError) throw outrosError || selectedError;
    return NextResponse.json({
      success: true,
      data: {
        hasIntro: Boolean(branding.intro),
        hasOutro: Boolean(branding.outro),
        outros: outros || [],
        selectedOutroAssetId: selected?.outro_asset_id || null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    console.error("[CompositionBranding] Could not inspect branding", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "No se pudo consultar la configuración de intro y outro." }, { status: 500 });
  }
}

/** Resolves and freezes approved organization branding for a single draft. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const rawBody = await request.text();
    const requestedSelection = rawBody ? outroSelectionSchema.parse(JSON.parse(rawBody)) : null;
    if (requestedSelection) {
      if (requestedSelection.outroAssetId) {
        const { data: outro } = await authorization.admin.from("organization_assembly_assets").select("id").eq("id", requestedSelection.outroAssetId).eq("organization_id", authorization.organizationId).eq("kind", "OUTRO").eq("status", "APPROVED").maybeSingle();
        if (!outro) return NextResponse.json({ error: "El outro seleccionado no pertenece a esta empresa o no está aprobado." }, { status: 400 });
      }
      const { error: selectionError } = await authorization.admin.from("video_composition_draft_branding").upsert({
        draft_id: draftId,
        organization_id: authorization.organizationId,
        intro_asset_id: null,
        intro_source: "ASSEMBLY_OVERRIDE",
        outro_asset_id: requestedSelection.outroAssetId,
        resolved_at: new Date().toISOString(),
        resolved_by: authorization.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "draft_id" });
      if (selectionError) throw selectionError;
    }
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
    const current = await getCurrentCompositionDocument({ draftId, organizationId: authorization.organizationId, supabase: authorization.admin });
    const document = reconcileAssemblyBrandingDocument(current.document, branding);
    const updated = await applyAndAppendCompositionDocumentPatches({
      auditSource: "SYSTEM",
      draftId,
      expectedDocumentHash: current.documentHash,
      organizationId: authorization.organizationId,
      patch: {
        operations: [{ document, type: "document.reconcile" }],
        source: "USER",
        summary: "Actualizó el outro seleccionado para este video.",
      },
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data: { branding, ...updated } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    if (error instanceof CompositionDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
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
