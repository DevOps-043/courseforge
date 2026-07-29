import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenRepository } from "@/domains/production/providers/heygen/heygen.repository";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para leer presets de HeyGen." },
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

    const repository = new HeygenRepository(getServiceRoleClient());
    const [avatars, voices] = await Promise.all([
      repository.listAvatarPresets(tenant.organizationId),
      repository.listVoicePresets(tenant.organizationId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        avatars,
        voices,
      },
    });
  } catch (error: unknown) {
    console.error("[API /production/heygen/presets] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al leer presets de HeyGen." },
      { status: 500 },
    );
  }
}
