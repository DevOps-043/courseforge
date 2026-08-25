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
  ProductionProviderCredentialError,
  ProductionProviderCredentialsService,
} from "@/domains/production/providers/credentials/provider-credentials.service";
import { createClient } from "@/utils/supabase/server";

const heygenConnectionRequestSchema = z
  .object({
    apiKey: z.string().trim().min(12).max(500),
  })
  .strict();

export async function GET() {
  try {
    const context = await resolveAuthorizedConnectionContext("consultar");
    if (context.response) return context.response;

    const service = new ProductionProviderCredentialsService({
      supabase: getServiceRoleClient(),
    });
    const status = await service.getCredentialStatus({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    console.error("[API /production/heygen/connection GET] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "No se pudo consultar la conexion HeyGen." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = heygenConnectionRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const context = await resolveAuthorizedConnectionContext("configurar");
    if (context.response) return context.response;

    const admin = getServiceRoleClient();
    const service = new ProductionProviderCredentialsService({ supabase: admin });
    const status = await service.upsertHeygenAvatarApiKey({
      apiKey: payload.apiKey,
      createdBy: context.user.userId,
      organizationId: context.tenant.organizationId,
    });

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Ingresa una API key de HeyGen valida." },
        { status: 400 },
      );
    }

    if (error instanceof ProductionProviderCredentialError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("[API /production/heygen/connection POST] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "No se pudo guardar la conexion HeyGen." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const context = await resolveAuthorizedConnectionContext("desconectar");
    if (context.response) return context.response;

    const admin = getServiceRoleClient();
    const service = new ProductionProviderCredentialsService({ supabase: admin });
    const status = await service.revokeCredential({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    console.error("[API /production/heygen/connection DELETE] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "No se pudo desconectar HeyGen." },
      { status: 500 },
    );
  }
}

async function resolveAuthorizedConnectionContext(action: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return {
      response: NextResponse.json({ error: "No autorizado." }, { status: 401 }),
      tenant: null as never,
      user: null as never,
    };
  }

  const canReview = await canReviewContent(user.userId);
  if (!canReview) {
    return {
      response: NextResponse.json(
        { error: `No tienes permisos para ${action} HeyGen.` },
        { status: 403 },
      ),
      tenant: null as never,
      user,
    };
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      response: NextResponse.json(
        { error: "Empresa no valida o no autorizada." },
        { status: 403 },
      ),
      tenant: null as never,
      user,
    };
  }

  return { response: null, tenant, user };
}
