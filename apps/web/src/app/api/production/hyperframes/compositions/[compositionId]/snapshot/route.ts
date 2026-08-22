import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import { CompositionSnapshotError, snapshotCompositionDocument } from "@/domains/production/composition-editor/composition-snapshot.service";
import {
  DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID,
  getHyperframesRenderProfile,
  HYPERFRAMES_RENDER_PROFILE_IDS,
} from "@/domains/production/hyperframes/hyperframes-render-profiles";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ compositionId: string }>; }
const bodySchema = z.object({
  draftId: z.string().uuid(),
  renderProfileId: z.enum(HYPERFRAMES_RENDER_PROFILE_IDS).default(DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await authorize(); if (auth instanceof NextResponse) return auth;
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const { draftId, renderProfileId } = bodySchema.parse(await request.json());
    const data = await snapshotCompositionDocument({
      compositionId,
      draftId,
      organizationId: auth.organizationId,
      renderProfile: getHyperframesRenderProfile(renderProfileId),
      supabase: auth.admin,
      userId: auth.userId,
    });
    return NextResponse.json({ success: true, data }, { status: data.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return NextResponse.json({ error: error.message, code: error.code, retryable: true }, { status: 503 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La solicitud de snapshot no es v\u00e1lida." }, { status: 400 });
    if (error instanceof CompositionSnapshotError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[API /production/hyperframes/compositions/:id/snapshot] Failed:", { code: error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "No se pudo preparar el snapshot de ensamble." }, { status: 500 });
  }
}
async function authorize() { const supabase = await createClient(); const user = await getAuthenticatedUser(supabase); if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 }); const tenant = await resolveActiveTenantContext(); if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 }); if (!(await canReviewContent(user.userId, tenant))) return NextResponse.json({ error: "No tienes permisos para ensamblar videos." }, { status: 403 }); return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId }; }
