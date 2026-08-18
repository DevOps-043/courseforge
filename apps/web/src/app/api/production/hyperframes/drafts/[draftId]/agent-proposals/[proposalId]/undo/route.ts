import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { undoStoredCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../../_route-support";
import { COMPOSITION_VERSION_FALLBACK_HEADER, resolveCompositionDocumentPrecondition } from "@/domains/production/composition-editor/composition-document-version";

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionAgentRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    const precondition = resolveCompositionDocumentPrecondition({
      fallbackHeader: request.headers.get(COMPOSITION_VERSION_FALLBACK_HEADER),
      ifMatchHeader: request.headers.get("if-match"),
    });
    if (!precondition.ok) {
      return NextResponse.json({ error: "Falta una versión aplicada válida y consistente para la propuesta." }, {
        status: 428,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const data = await undoStoredCompositionAgentProposal({
      draftId: z.string().uuid().parse(routeParams.draftId),
      expectedDocumentHash: precondition.documentHash,
      organizationId: authorization.organizationId,
      proposalId: z.string().uuid().parse(routeParams.proposalId),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { "Cache-Control": "private, no-store", ETag: `"${data.documentHash}"` },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de propuesta inválido." }, { status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error);
    console.error("[CompositionAgentUndo] Failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo deshacer la propuesta." }, { status: 500 });
  }
}
