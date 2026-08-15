import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getCurrentCompositionDocument, CompositionDocumentError } from "@/domains/production/composition-editor/composition-document.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Compiles an isolated preview from the native versioned document. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const current = await getCurrentCompositionDocument({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document: current.document,
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const previewHtml = await compileCompositionPreview({ assetUrls, document: current.document });
    return new NextResponse(previewHtml, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    if (error instanceof CompositionDocumentError || error instanceof CompositionPreviewCompilerError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof CompositionDocumentError ? error.status : 400 });
    }
    console.error("[API /production/hyperframes/drafts/:id/preview] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo preparar el preview de la composición." }, { status: 500 });
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para previsualizar el video." }, { status: 403 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}
