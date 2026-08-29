import { NextResponse } from "next/server";
import { z } from "zod";
import { dismissStoredCompositionPresetPreview, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    await dismissStoredCompositionPresetPreview({
      applicationId: z.string().uuid().parse(routeParams.applicationId),
      draftId: z.string().uuid().parse(routeParams.draftId),
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de preview inválido." }, { status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    return NextResponse.json({ error: "No se pudo descartar el preview." }, { status: 500 });
  }
}
