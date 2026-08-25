import { NextResponse } from "next/server";
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

export async function POST() {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(user.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para validar HeyGen." },
        { status: 403 },
      );
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json(
        { error: "Empresa no valida o no autorizada." },
        { status: 403 },
      );
    }

    const service = new ProductionProviderCredentialsService({
      supabase: getServiceRoleClient(),
    });
    const status = await service.validateActiveHeygenAvatarCredential({
      organizationId: tenant.organizationId,
    });

    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    if (error instanceof ProductionProviderCredentialError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("[API /production/heygen/connection/validate] Unexpected error:", {
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "No se pudo validar la conexion HeyGen." },
      { status: 500 },
    );
  }
}
