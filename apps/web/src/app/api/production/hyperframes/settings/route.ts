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
  getHyperframesGenerationSettings,
  hyperframesGenerationSettingsSchema,
  saveHyperframesGenerationSettings,
} from "@/domains/production/hyperframes/hyperframes-generation-settings.service";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const authorization = await getSettingsAuthorization();
    if (authorization instanceof NextResponse) return authorization;
    const settings = await getHyperframesGenerationSettings({
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    return respondSettingsError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const settings = hyperframesGenerationSettingsSchema.parse(
      await request.json().catch(() => ({})),
    );
    const authorization = await getSettingsAuthorization();
    if (authorization instanceof NextResponse) return authorization;
    const result = await saveHyperframesGenerationSettings({
      organizationId: authorization.organizationId,
      settings,
      supabase: authorization.admin,
      updatedBy: authorization.userId,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return respondSettingsError(error);
  }
}

async function getSettingsAuthorization() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(authenticatedUser.userId))) {
    return NextResponse.json(
      { error: "No tienes permisos para configurar el estudio de video." },
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

function respondSettingsError(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Configuración de generación de video inválida." },
      { status: 400 },
    );
  }
  console.error("[API /production/hyperframes/settings] Unexpected error:", {
    message: getErrorMessage(error),
  });
  return NextResponse.json(
    { error: "No se pudo actualizar la configuración de video." },
    { status: 500 },
  );
}
