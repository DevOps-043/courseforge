import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { CompositionSnapshotError, snapshotCompositionDocument } from "@/domains/production/composition-editor/composition-snapshot.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ compositionId: string }>; }
const bodySchema = z.object({ draftId: z.string().uuid() }).strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await authorize(); if (auth instanceof NextResponse) return auth;
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const { draftId } = bodySchema.parse(await request.json());
    const data = await snapshotCompositionDocument({ compositionId, draftId, organizationId: auth.organizationId, supabase: auth.admin, userId: auth.userId });
    return NextResponse.json({ success: true, data }, { status: data.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La solicitud de snapshot no es v\u00e1lida." }, { status: 400 });
    if (error instanceof CompositionSnapshotError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[API /production/hyperframes/compositions/:id/snapshot] Failed:", { code: error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "No se pudo preparar el snapshot de ensamble." }, { status: 500 });
  }
}
async function authorize() { const supabase = await createClient(); const user = await getAuthenticatedUser(supabase); if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 }); if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para ensamblar videos." }, { status: 403 }); const tenant = await resolveActiveTenantContext(); if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 }); return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId }; }
