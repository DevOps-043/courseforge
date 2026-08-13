import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { proposeCompositionEdits, CompositionAgentProposalError } from "@/domains/production/composition-editor/composition-agent.service";
import { getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Produces an unpersisted, allow-listed proposal for the currently saved document version. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const current = await getCurrentCompositionDocument({ draftId, organizationId: authorization.organizationId, supabase: authorization.admin });
    const proposal = await proposeCompositionEdits({
      document: current.document,
      input: await request.json(),
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data: { ...proposal, documentHash: current.documentHash } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La solicitud de asistencia no es v\u00e1lida." }, { status: 400 });
    if (error instanceof CompositionAgentProposalError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[API /production/hyperframes/drafts/:id/agent-proposals] Failed:", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "No se pudo preparar la propuesta de edici\u00f3n." }, { status: 500 });
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no v\u00e1lida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}
