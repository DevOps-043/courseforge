import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { applyStoredCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../../_route-support";

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

const applyRequestSchema = z.object({ reinforcedConfirmation: z.boolean().default(false) }).strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionAgentRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    const expectedDocumentHash = request.headers.get("if-match")?.replaceAll('"', "").trim();
    if (!expectedDocumentHash || !/^[a-f0-9]{64}$/i.test(expectedDocumentHash)) {
      return NextResponse.json({ error: "Falta la versión base de la propuesta (If-Match)." }, { status: 428 });
    }
    const body = applyRequestSchema.parse(await request.json());
    const data = await applyStoredCompositionAgentProposal({
      draftId: z.string().uuid().parse(routeParams.draftId),
      expectedDocumentHash: expectedDocumentHash.toLowerCase(),
      organizationId: authorization.organizationId,
      proposalId: z.string().uuid().parse(routeParams.proposalId),
      reinforcedConfirmation: body.reinforcedConfirmation,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { "Cache-Control": "private, no-store", ETag: `"${data.documentHash}"` },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La confirmación no es válida." }, { status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error);
    console.error("[CompositionAgentApply] Failed", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo aplicar la propuesta." }, { status: 500 });
  }
}
