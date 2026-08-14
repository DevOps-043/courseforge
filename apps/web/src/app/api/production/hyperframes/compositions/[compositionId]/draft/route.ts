import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { initializeHyperframesDraft, HyperframesDraftError } from "@/domains/production/hyperframes/hyperframes-draft.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ compositionId: string }>; }

/** Allocates and hydrates the mutable editor project without generating a render revision. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { compositionId } = await context.params;
    const draft = await initializeHyperframesDraft({
      compositionId: z.string().uuid().parse(compositionId),
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data: draft });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de composición inválido." }, { status: 400 });
    if (error instanceof HyperframesDraftError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[API /production/hyperframes/compositions/:id/draft] Unexpected error:", serializeError(error));
    return NextResponse.json({ error: "No se pudo preparar el proyecto de edición." }, { status: 500 });
  }
}

function serializeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      details: typeof candidate.details === "string" ? candidate.details.slice(0, 500) : null,
      hint: typeof candidate.hint === "string" ? candidate.hint.slice(0, 300) : null,
      message: typeof candidate.message === "string" ? candidate.message.slice(0, 500) : getErrorMessage(error),
    };
  }
  return { message: getErrorMessage(error) };
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
