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
  HeygenApiError,
} from "@/domains/production/providers/heygen/heygen.client";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HEYGEN_VIDEO_STATUSES } from "@/domains/production/providers/heygen/heygen.types";
import { createClient } from "@/utils/supabase/server";

interface RouteContext {
  params: Promise<{ videoId: string }>;
}

const videoIdSchema = z.string().trim().min(1).max(200);

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { videoId: rawVideoId } = await context.params;
    const videoId = videoIdSchema.parse(rawVideoId);
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para consultar videos de HeyGen." },
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

    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: getServiceRoleClient(),
    });
    const video = await heygenAuth.client.getVideo(videoId);
    const providerStatus = video.status.toLowerCase();
    const isCompleted = providerStatus === HEYGEN_VIDEO_STATUSES.COMPLETED;
    const isFailed = providerStatus === HEYGEN_VIDEO_STATUSES.FAILED;

    return NextResponse.json({
      success: true,
      data: {
        asset:
          isCompleted && video.videoUrl
            ? {
                id: video.videoId,
                publicUrl: video.videoUrl,
                storagePath: `heygen://${video.videoId}`,
              }
            : null,
        jobId: video.videoId,
        providerJobId: video.videoId,
        providerStatus: video.status,
        standalone: true,
        status: isCompleted
          ? "SUCCEEDED"
          : isFailed
            ? "FAILED"
            : "WAITING_PROVIDER",
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Video ID invalido para consultar HeyGen." },
        { status: 400 },
      );
    }

    if (error instanceof HeygenApiError) {
      return NextResponse.json(
        { error: "No se pudo consultar el video standalone en HeyGen." },
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

    console.error(
      "[API /production/heygen/standalone/videos/:videoId] Unexpected error:",
      {
        message: getErrorMessage(error),
      },
    );

    return NextResponse.json(
      { error: "Error interno del servidor al consultar HeyGen standalone." },
      { status: 500 },
    );
  }
}

function buildRetryAfterHeaders(retryAfterSeconds?: number) {
  return retryAfterSeconds
    ? { "Retry-After": String(retryAfterSeconds) }
    : undefined;
}
