import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorDetails, getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import {
  resolveActiveTenantContext,
  TenantContextLookupError,
} from "@/lib/server/tenant-context";
import {
  HyperframesFinalVideoDeletionError,
  HyperframesFinalVideoDeletionService,
} from "@/domains/production/hyperframes/hyperframes-final-video-deletion.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext {
  params: Promise<{ compositionId: string }>;
}

const deleteRequestSchema = z.object({
  assetId: z.string().uuid(),
}).strict();

/** Deletes only the current imported final video for this composition's lesson. */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json(
        { error: "Empresa no válida o no autorizada." },
        { status: 403 },
      );
    }
    if (!(await canReviewContent(user.userId, tenant))) {
      return NextResponse.json(
        { error: "No tienes permisos para eliminar videos finales." },
        { status: 403 },
      );
    }

    const compositionId = z.string().uuid().parse((await context.params).compositionId);
    const { assetId } = deleteRequestSchema.parse(await request.json().catch(() => ({})));
    const result = await new HyperframesFinalVideoDeletionService(
      getServiceRoleClient(),
    ).deleteLatestForComposition({
      compositionId,
      expectedAssetId: assetId,
      organizationId: tenant.organizationId,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (error instanceof TenantContextLookupError) {
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: true },
        { status: 503 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "La solicitud para eliminar el video no es válida." },
        { status: 400 },
      );
    }
    if (error instanceof HyperframesFinalVideoDeletionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[API HyperFrames final-video DELETE] Unexpected error:", {
      ...getErrorDetails(error),
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "No se pudo eliminar el video final de esta lección." },
      { status: 500 },
    );
  }
}
