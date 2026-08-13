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
  getOrCreateHyperframesCompositionDraft,
  HyperframesCompositionError,
  listHyperframesCompositions,
} from "@/domains/production/hyperframes/hyperframes-composition.service";
import { createClient } from "@/utils/supabase/server";

const createCompositionSchema = z.object({
  componentId: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
}).strict();

const componentIdSchema = z.string().uuid().optional();

export async function GET(request: Request) {
  try {
    const authorization = await getHyperframesAuthorization();
    if (authorization instanceof NextResponse) return authorization;
    const componentId = componentIdSchema.parse(
      new URL(request.url).searchParams.get("componentId") || undefined,
    );
    const compositions = await listHyperframesCompositions({
      componentId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data: compositions });
  } catch (error) {
    return respondCompositionError(error, "No se pudieron listar composiciones de video.");
  }
}

export async function POST(request: Request) {
  try {
    const input = createCompositionSchema.parse(await request.json().catch(() => ({})));
    const authorization = await getHyperframesAuthorization();
    if (authorization instanceof NextResponse) return authorization;
    const result = await getOrCreateHyperframesCompositionDraft({
      componentId: input.componentId,
      createdBy: authorization.userId,
      name: input.name || "Composición de video",
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json(
      { success: true, data: result.composition, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return respondCompositionError(error, "No se pudo crear la composición de video.");
  }
}

async function getHyperframesAuthorization() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(authenticatedUser.userId))) {
    return NextResponse.json(
      { error: "No tienes permisos para administrar composiciones de video." },
      { status: 403 },
    );
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return NextResponse.json(
      { error: "Empresa no válida o no autorizada." },
      { status: 403 },
    );
  }
  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    userId: authenticatedUser.userId,
  };
}

function respondCompositionError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: "Payload inválido para la composición de video." }, { status: 400 });
  }
  if (error instanceof HyperframesCompositionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[API /production/hyperframes/compositions] Unexpected error:", {
    message: getErrorMessage(error),
  });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
