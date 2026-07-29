import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
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
import { heygenJobStatusResponseSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

const jobIdSchema = z.string().uuid();

export async function GET(request: Request, context: RouteContext) {
  try {
    const { jobId: rawJobId } = await context.params;
    const jobId = jobIdSchema.parse(rawJobId);
    const autoPromote = new URL(request.url).searchParams.get("autoPromote") === "true";
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para consultar jobs de HeyGen." },
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

    const admin = getServiceRoleClient();
    const heygenAuth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const service = new HeygenVideoService(
      admin,
      heygenAuth.client,
    );
    const statusResult = await service.getAvatarVideoJobStatus({
      autoPromote,
      createdBy: authenticatedUser.userId,
      jobId,
      organizationId: tenant.organizationId,
    });

    return NextResponse.json({
      success: true,
      data: heygenJobStatusResponseSchema.parse(statusResult),
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Job ID invalido para consultar HeyGen." },
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
        { error: "No se pudo consultar el estado del video en HeyGen." },
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

    console.error("[API /production/heygen/jobs/:jobId] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al consultar job HeyGen." },
      { status: 500 },
    );
  }
}

function buildRetryAfterHeaders(retryAfterSeconds?: number) {
  return retryAfterSeconds
    ? { "Retry-After": String(retryAfterSeconds) }
    : undefined;
}
