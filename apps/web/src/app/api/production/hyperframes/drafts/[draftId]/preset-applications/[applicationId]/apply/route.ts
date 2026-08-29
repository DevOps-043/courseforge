import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { applyStoredCompositionPreset, CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { formatCompositionDocumentEtag } from "@/domains/production/composition-editor/composition-document-version";
import { authorizeCompositionPresetRequest, compositionPresetErrorResponse, resolveCompositionPresetMutationPrecondition } from "../../../../../_composition-preset-route-support";

interface RouteContext { params: Promise<{ applicationId: string; draftId: string }>; }

export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionPresetRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    const applicationId = z.string().uuid().parse(routeParams.applicationId);
    const draftId = z.string().uuid().parse(routeParams.draftId);
    const precondition = resolveCompositionPresetMutationPrecondition({
      documentId: draftId,
      operation: "APPLY",
      request,
    });
    if (!precondition.ok) return precondition.response;
    const data = await applyStoredCompositionPreset({
      applicationId,
      draftId,
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    console.info("[CompositionPresets] Preset application completed", {
      event: "composition_preset_applied",
      version: data.version,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { "Cache-Control": "private, no-store", ETag: formatCompositionDocumentEtag(data.documentHash) },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de aplicación inválido." }, {
      status: 400,
      headers: { "Cache-Control": "private, no-store" },
    });
    if (error instanceof CompositionPresetStoreError) return compositionPresetErrorResponse(error);
    console.error("[CompositionPresetApply] Failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo aplicar el preset." }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
