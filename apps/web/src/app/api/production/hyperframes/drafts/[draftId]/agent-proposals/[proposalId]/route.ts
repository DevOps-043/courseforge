import { NextResponse } from "next/server";
import { z } from "zod";
import { dismissStoredCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "../_route-support";

interface RouteContext { params: Promise<{ draftId: string; proposalId: string }>; }

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionAgentRequest();
    if (authorization instanceof NextResponse) return authorization;
    const routeParams = await context.params;
    await dismissStoredCompositionAgentProposal({
      draftId: z.string().uuid().parse(routeParams.draftId),
      organizationId: authorization.organizationId,
      proposalId: z.string().uuid().parse(routeParams.proposalId),
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de propuesta inválido." }, { status: 400 });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error);
    return NextResponse.json({ error: "No se pudo descartar la propuesta." }, { status: 500 });
  }
}
