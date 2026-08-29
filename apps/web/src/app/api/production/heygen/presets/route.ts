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
    const [avatars, voices, archivedAvatars, archivedVoices] = await Promise.all([
      repository.listAvatarPresets(tenant.organizationId),
      repository.listVoicePresets(tenant.organizationId),
      repository.listArchivedAvatarPresets(tenant.organizationId),
      repository.listArchivedVoicePresets(tenant.organizationId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        avatars,
        archivedAvatars,
        archivedVoices,
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

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return NextResponse.json({ error: "No tienes permisos para administrar presets de HeyGen." }, { status: 403 });
    }
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no valida o no autorizada." }, { status: 403 });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const kind = body?.kind;
    const presetId = body?.presetId;
    const archived = body?.archived;
    if ((kind !== "avatar" && kind !== "voice") || typeof presetId !== "string" || typeof archived !== "boolean") {
      return NextResponse.json({ error: "Solicitud de limpieza invalida." }, { status: 400 });
    }

    const repository = new HeygenRepository(getServiceRoleClient());
    const result = await repository.setCatalogPresetArchived({ archived, kind, organizationId: tenant.organizationId, presetId });
    if (result === "NOT_FOUND") return NextResponse.json({ error: "Preset no encontrado." }, { status: 404 });
    if (result === "DEFAULT") {
      return NextResponse.json({ error: "Selecciona otro preset predeterminado antes de archivarlo." }, { status: 409 });
    }
    return NextResponse.json({ success: true, data: { archived, kind, presetId } });
  } catch (error: unknown) {
    console.error("[API /production/heygen/presets PATCH] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "Error interno del servidor al actualizar el catalogo." }, { status: 500 });
  }
}
