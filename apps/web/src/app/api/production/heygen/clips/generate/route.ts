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
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import {
  buildResolutionRejectionHint,
} from "@/domains/production/providers/heygen/heygen-request-constraints";
import { heygenGenerateClipsRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  let requestedResolution: "720p" | "1080p" | "4k" = "1080p";
  try {
    const payload = heygenGenerateClipsRequestSchema.parse(
      await request.json().catch(() => ({})),
    );
    requestedResolution = payload.resolution;
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para generar clips con HeyGen." },
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

    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(payload.componentId);
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
    const service = new HeygenScenesService(
      authorizedComponent.admin,
      heygenAuth.client,
    );
    const result = await service.generateSceneClips({
      createdBy: authenticatedUser.userId,
      options: payload,
      organizationId: tenant.organizationId,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Payload invalido para generar clips HeyGen." },
        { status: 400 },
      );
    }

    if (error instanceof HeygenScenesServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof HeygenApiError) {
      return NextResponse.json(
        {
          error: error.message,
          hint: buildResolutionRejectionHint(requestedResolution),
          providerCode: error.providerCode || null,
          retryAfterSeconds: error.retryAfterSeconds || null,
        },
        {
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
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

    console.error("[API /production/heygen/clips/generate] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al generar clips HeyGen." },
      { status: 500 },
    );
  }
}
