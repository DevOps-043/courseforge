import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  HeygenVideoService,
  HeygenVideoServiceError,
} from "@/domains/production/providers/heygen/heygen-video.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { heygenGenerateVideoRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  try {
    const payload = heygenGenerateVideoRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para generar videos con HeyGen." },
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

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(
      payload.componentId,
    );
    if (!authorizedComponent) {
      return NextResponse.json(
        { error: "Componente no encontrado para esta empresa." },
        { status: 404 },
      );
    }

    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: authorizedComponent.admin,
    });
    const service = new HeygenVideoService(
      authorizedComponent.admin,
      heygenAuth.client,
    );
    const result = await service.createAvatarVideoForComponent({
      componentContent: authorizedComponent.component.content,
      componentType: authorizedComponent.component.type || "UNKNOWN",
      createdBy: authenticatedUser.userId,
      options: payload,
      organizationId: tenant.organizationId,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Payload invalido para generar video HeyGen." },
        { status: 400 },
      );
    }

    if (error instanceof HeygenVideoServiceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof HeygenApiError) {
      return NextResponse.json(
        { error: "HeyGen rechazo la solicitud de generacion." },
        {
          headers: buildRetryAfterHeaders(error.retryAfterSeconds),
          status: error.status === 429 ? 429 : 502,
        },
      );
    }

    if (error instanceof HeygenCredentialResolverError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("[API /production/heygen/videos] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al generar video HeyGen." },
      { status: 500 },
    );
  }
}

function buildRetryAfterHeaders(retryAfterSeconds?: number) {
  return retryAfterSeconds
    ? { "Retry-After": String(retryAfterSeconds) }
    : undefined;
}
