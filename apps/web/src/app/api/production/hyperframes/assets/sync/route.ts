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
    const data = await syncHyperframesSourceAssetsFromProduction({
      componentId: input.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
      supabase: getServiceRoleClient(),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Component ID inválido." }, { status: 400 });
    if (error instanceof HyperframesSourceAssetError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API /production/hyperframes/assets/sync] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudieron preparar los assets del paso de Producción." }, { status: 500 });
  }
}
