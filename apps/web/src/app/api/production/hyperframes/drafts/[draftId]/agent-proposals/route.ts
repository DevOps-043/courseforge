import { NextResponse } from "next/server";
import { z } from "zod";
import { proposeCompositionEdits, CompositionAgentProposalError } from "@/domains/production/composition-editor/composition-agent.service";
import { getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { persistCompositionAgentProposal, CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { authorizeCompositionAgentRequest, compositionAgentStoreErrorResponse } from "./_route-support";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Produces an unpersisted, allow-listed proposal for the currently saved document version. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeCompositionAgentRequest();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const current = await getCurrentCompositionDocument({ draftId, organizationId: authorization.organizationId, supabase: authorization.admin });
    const proposal = await proposeCompositionEdits({
      baseDocumentHash: current.documentHash,
      document: current.document,
      input: await request.json(),
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const { model, recovery, ...envelope } = proposal;
    const persisted = await persistCompositionAgentProposal({
      draftId,
      envelope,
      model,
      organizationId: authorization.organizationId,
      recovery,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data: { ...envelope, ...persisted, model, recovery, documentHash: current.documentHash } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La solicitud de asistencia no es v\u00e1lida." }, { status: 400 });
    if (error instanceof CompositionAgentProposalError) return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
    if (error instanceof CompositionAgentProposalStoreError) return compositionAgentStoreErrorResponse(error);
    console.error("[API /production/hyperframes/drafts/:id/agent-proposals] Failed:", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "No se pudo preparar la propuesta de edici\u00f3n." }, { status: 500 });
  }
}
