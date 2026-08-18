import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { getCompositionAgentPreviewDocument, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../../_route-support";

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

/** Compiles the simulated proposal using the same compiler and assets as the saved preview. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionAgentRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    const draftId = z.string().uuid().parse(routeParams.draftId);
    const proposalId = z.string().uuid().parse(routeParams.proposalId);
    const document = await getCompositionAgentPreviewDocument({
      draftId,
      organizationId: authorization.organizationId,
      proposalId,
      supabase: authorization.admin,
    });
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document,
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const html = await compileCompositionPreview({ assetUrls, document });
    return new NextResponse(html, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de propuesta inválido." }, { status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error);
    if (error instanceof CompositionPreviewCompilerError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[CompositionAgentPreview] Failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo preparar el preview de la propuesta." }, { status: 500 });
  }
}
