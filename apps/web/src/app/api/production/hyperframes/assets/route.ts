import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { listHyperframesSourceAssets } from "@/domains/production/hyperframes/hyperframes-source-asset.service";
import { createClient } from "@/utils/supabase/server";

const componentIdSchema = z.string().uuid();

/** Lists existing, traceable media that an internal composition may reuse. */
export async function GET(request: Request) {
  try {
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId"),
    );
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return NextResponse.json(
        { error: "No tienes permisos para consultar assets de video." },
        { status: 403 },
      );
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json(
        { error: "Empresa no válida o no autorizada." },
        { status: 403 },
      );
    }
    const assets = await listHyperframesSourceAssets({
      componentId,
      organizationId: tenant.organizationId,
      supabase: getServiceRoleClient(),
    });
    return NextResponse.json({ success: true, data: assets });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Component ID inválido." }, { status: 400 });
    }
    console.error("[API /production/hyperframes/assets] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "No se pudieron consultar los assets de video." },
      { status: 500 },
    );
  }
}
