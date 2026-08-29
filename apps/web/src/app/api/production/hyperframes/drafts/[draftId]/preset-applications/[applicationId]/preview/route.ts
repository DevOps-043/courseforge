import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { getCompositionPresetPreviewDocument, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { resolveCompositionPreviewAssetUrls } from "@/domains/production/composition-editor/composition-preview-assets.service";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "@/domains/production/composition-editor/composition-preview-compiler.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse, COMPOSITION_PRESET_PREVIEW_HEADERS } from "../../../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    const draftId = z.string().uuid().parse(routeParams.draftId);
    const document = await getCompositionPresetPreviewDocument({
      applicationId: z.string().uuid().parse(routeParams.applicationId),
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const assetUrls = await resolveCompositionPreviewAssetUrls({
      document,
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return new NextResponse(await compileCompositionPreview({ assetUrls, document }), { headers: COMPOSITION_PRESET_PREVIEW_HEADERS });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de preview inválido." }, { status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    if (error instanceof CompositionPreviewCompilerError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[CompositionPresetPreview] Compilation failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo compilar el preview del preset." }, { status: 500 });
  }
}
