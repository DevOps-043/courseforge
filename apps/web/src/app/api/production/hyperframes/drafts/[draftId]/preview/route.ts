import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getCurrentCompositionDocument, CompositionDocumentError } from "@/domains/production/composition-editor/composition-document.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import {
  createPreviewCorrelationId,
  elapsedMilliseconds,
  formatServerTimingHeader,
  type CompositionPreviewAssetDiagnostics,
} from "@/domains/production/composition-editor/composition-preview-performance";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Compiles an isolated preview from the native versioned document. */
export async function GET(request: Request, context: RouteContext) {
  const requestStartedAt = performance.now();
  const correlationId = createPreviewCorrelationId(request.headers.get("x-correlation-id"));
  try {
    const authorizationStartedAt = performance.now();
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const authorizationMs = elapsedMilliseconds(authorizationStartedAt);
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const documentStartedAt = performance.now();
    const current = await getCurrentCompositionDocument({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const documentMs = elapsedMilliseconds(documentStartedAt);
    let assetDiagnostics: CompositionPreviewAssetDiagnostics | null = null;
    const assetsStartedAt = performance.now();
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document: current.document,
      draftId,
      onDiagnostics: (diagnostics) => { assetDiagnostics = diagnostics; },
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const assetsMs = elapsedMilliseconds(assetsStartedAt);
    const compileStartedAt = performance.now();
    const previewHtml = await compileCompositionPreview({
      assetUrls,
      document: current.document,
      documentHash: current.documentHash,
    });
    const compileMs = elapsedMilliseconds(compileStartedAt);
    const timings = {
      assetsMs,
      authorizationMs,
      compileMs,
      documentMs,
      totalMs: elapsedMilliseconds(requestStartedAt),
    };
    console.info("[CompositionPreviewPerformance] Preview compiled", {
      assetDiagnostics,
      clipCount: current.document.clips.length,
      correlationId,
      event: "composition_preview_compiled",
      timings,
      trackCount: current.document.tracks.length,
    });
    return new NextResponse(previewHtml, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "Server-Timing": formatServerTimingHeader(timings),
        "X-Correlation-Id": correlationId,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    if (error instanceof CompositionDocumentError || error instanceof CompositionPreviewCompilerError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof CompositionDocumentError ? error.status : 400 });
    }
    console.error("[API /production/hyperframes/drafts/:id/preview] Unexpected error:", {
      correlationId,
      durationMs: Math.round(elapsedMilliseconds(requestStartedAt)),
      message: getErrorMessage(error),
    });
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
