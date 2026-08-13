import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ revisionId: string }>; }

/** Returns only compiler-generated preview HTML; rendering still uses the ZIP. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const revisionId = z.string().uuid().parse((await context.params).revisionId);
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return NextResponse.json({ error: "No tienes permisos para previsualizar el video." }, { status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
    const { data, error } = await getServiceRoleClient()
      .from("video_composition_revisions")
      // The revision already carries organization_id. Joining the composition
      // is ambiguous because the schema has more than one FK between these
      // tables, which made every preview request fail before HTML was read.
      .select("manifest")
      .eq("id", revisionId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();
    if (error) throw error;
    const previewHtml = readPreviewHtml(data?.manifest);
    if (!previewHtml) return NextResponse.json({ error: "Preview de video no disponible." }, { status: 404 });
    return new NextResponse(previewHtml, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src https: data:",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Revision ID inválido." }, { status: 400 });
    }
    console.error("[API /production/hyperframes/revisions/:id/preview] Unexpected error");
    return NextResponse.json({ error: "No se pudo preparar el preview de video." }, { status: 500 });
  }
}

function readPreviewHtml(manifest: unknown) {
  if (!manifest || typeof manifest !== "object") return null;
  const value = (manifest as Record<string, unknown>).preview_html;
  return typeof value === "string" && value.length > 0 && value.length <= 200_000 ? value : null;
}
