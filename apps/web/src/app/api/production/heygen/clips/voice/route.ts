import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import { heygenGenerateSceneVoiceRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

/** Generates or reuses independent voice tracks for persisted scene clips. */
export async function POST(request: Request) {
  try {
    const payload = heygenGenerateSceneVoiceRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) {
      return NextResponse.json({ error: "No tienes permisos para generar voces por escena." }, { status: 403 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });

    const authorized = await getAuthorizedMaterialComponentAdmin(payload.componentId);
    if (!authorized) {
      return NextResponse.json({ error: "Componente no encontrado para esta empresa." }, { status: 404 });
    }
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: authorized.admin,
    });
    const service = new HeygenScenesService(authorized.admin, auth.client);
    const data = await service.generateSceneVoiceClips({
      clipIds: payload.clipIds,
      componentId: payload.componentId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Payload inválido para generar voces por escena." }, { status: 400 });
    }
    if (error instanceof HeygenScenesServiceError || error instanceof HeygenCredentialResolverError) {
      return NextResponse.json({ error: error.message, code: error instanceof HeygenCredentialResolverError ? error.code : undefined }, { status: error.status });
    }

    console.error("[API /production/heygen/clips/voice] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "Error interno al generar las voces por escena." }, { status: 500 });
  }
}
