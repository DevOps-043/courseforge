import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HyperframesRevisionGenerationError,
  HyperframesRevisionGenerationService,
} from "@/domains/production/hyperframes/hyperframes-revision-generation.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ compositionId: string }>; }

const revisionRequestSchema = z.object({
  agentInstruction: z.string().trim().min(1).max(1_000).optional(),
  generationMode: z.enum(["AUTOMATIC", "AGENT_ASSISTED"]),
  selectedAssetIds: z.array(z.string().uuid()).min(1).max(250).optional(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  try {
    const { compositionId } = await context.params;
    const input = revisionRequestSchema.parse(await request.json().catch(() => ({})));
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const result = await new HyperframesRevisionGenerationService(authorization.admin).generate({
      ...input,
      compositionId: z.string().uuid().parse(compositionId),
      createdBy: authorization.userId,
      organizationId: authorization.organizationId,
    });
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Solicitud de revisión de video inválida." }, { status: 400 });
    }
    if (error instanceof HyperframesRevisionGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API /production/hyperframes/compositions/:id/revisions] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json({ error: "No se pudo generar la revisión de video." }, { status: 500 });
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(user.userId))) {
    return NextResponse.json({ error: "No tienes permisos para generar revisiones HyperFrames." }, { status: 403 });
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
