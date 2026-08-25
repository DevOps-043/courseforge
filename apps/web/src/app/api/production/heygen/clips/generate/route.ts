import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { runHeygenAvatarClipsBackground } from "@/domains/production/providers/heygen/heygen-avatar-background.service";
import {
  HeygenScenesService,
  HeygenScenesServiceError,
} from "@/domains/production/providers/heygen/heygen-scenes.service";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { heygenGenerateClipsRequestSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  try {
    const payload = heygenGenerateClipsRequestSchema.parse(
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
    const queued = await service.queueSceneClips({
      clipIds: payload.clipIds,
      clips: payload.clips,
      componentId: payload.componentId,
      organizationId: tenant.organizationId,
    });
    const backgroundRequest = {
      createdBy: authenticatedUser.userId,
      organizationId: tenant.organizationId,
      options: {
        ...payload,
        clips: queued.clips,
      },
    };

    try {
      await callBackgroundFunctionJson(
        "heygen-avatar-clips-background",
        signBackgroundPayload(backgroundRequest),
        {
          fallbackError: "No se pudo iniciar el worker de avatares.",
          localHandlerLoader: async () => ({
            handler: async () => {
              await runHeygenAvatarClipsBackground(backgroundRequest);
              return { statusCode: 200, body: JSON.stringify({ success: true }) };
            },
          }),
        },
      );
    } catch (dispatchError) {
      const message = getErrorMessage(
        dispatchError,
        "No se pudo iniciar el worker de avatares.",
      );
      await service.markQueuedSceneClipsFailed({
        clipIds: payload.clipIds,
        componentId: payload.componentId,
        errorMessage: message,
      });
      throw new HeygenScenesServiceError(message, 503);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          clips: queued.clips,
          jobs: [],
          submissionStatus: "QUEUED",
          voiceClips: queued.voiceClips,
        },
      },
      { status: 202 },
    );
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
