import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { undoStoredCompositionPreset, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { COMPOSITION_VERSION_FALLBACK_HEADER, formatCompositionDocumentEtag, resolveCompositionDocumentPrecondition } from "@/domains/production/composition-editor/composition-document-version";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse } from "../../../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const precondition = resolveCompositionDocumentPrecondition({
      fallbackHeader: request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER),
      ifMatchHeader: request.headers.get("if-match"),
    });
    if (!precondition.ok) return NextResponse.json({ error: "Falta la versión aplicada válida del documento." }, { status: 428 });
    const routeParams = await context.params;
    const data = await undoStoredCompositionPreset({
      applicationId: z.string().uuid().parse(routeParams.applicationId),
      draftId: z.string().uuid().parse(routeParams.draftId),
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { "Cache-Control": "private, no-store", ETag: formatCompositionDocumentEtag(data.documentHash) },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de aplicación inválido." }, { status: 400 });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresetUndo] Failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo deshacer el preset." }, { status: 500 });
  }
}
