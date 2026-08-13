import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ compositionId: string }>; }

/** Approval is the explicit gate between preview and billable cloud rendering. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return NextResponse.json({ error: "No tienes permisos para aprobar composiciones de video." }, { status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
    const admin = getServiceRoleClient();
    const { data: composition, error: readError } = await admin
      .from("video_compositions")
      .select("id, active_revision_id, status")
      .eq("id", compositionId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!composition) return NextResponse.json({ error: "Composición de video no encontrada." }, { status: 404 });
    if (composition.status !== "READY_FOR_PREVIEW" || !composition.active_revision_id) {
      return NextResponse.json({ error: "La composición debe tener una revisión lista para preview antes de aprobarse." }, { status: 409 });
    }
    const { error: updateError } = await admin
      .from("video_compositions")
      .update({ status: "READY_FOR_RENDER", updated_at: new Date().toISOString() })
      .eq("id", compositionId)
      .eq("organization_id", tenant.organizationId);
    if (updateError) throw updateError;
    return NextResponse.json({ success: true, data: { compositionId, revisionId: composition.active_revision_id, status: "READY_FOR_RENDER" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Composition ID inválido." }, { status: 400 });
    }
    console.error("[API /production/hyperframes/compositions/:id/approve] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json({ error: "No se pudo aprobar la composición de video." }, { status: 500 });
  }
}
