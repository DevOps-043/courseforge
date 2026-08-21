import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorDetails, getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HyperframesCloudApiError } from "@/domains/production/hyperframes/hyperframes-cloud.client";
import {
  getHyperframesClientForOrganization,
  HyperframesCredentialResolverError,
} from "@/domains/production/hyperframes/hyperframes-credential-resolver.service";
import {
  HyperframesRenderSubmissionError,
  HyperframesRenderSubmissionService,
} from "@/domains/production/hyperframes/hyperframes-render-submission.service";
import { HyperframesRenderRecoveryService } from "@/domains/production/hyperframes/hyperframes-render-recovery.service";
import { createClient } from "@/utils/supabase/server";

const renderRequestSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  format: z.enum(["mp4", "webm", "mov"]).optional(),
  fps: z.number().int().min(1).max(240).optional(),
  quality: z.enum(["draft", "standard", "high"]).optional(),
  resolution: z.enum(["1080p", "4k"]).optional(),
  revisionId: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
}).strict();

const recoverableRenderQuerySchema = z.object({
  compositionId: z.string().uuid(),
});

/** Returns durable provider work so a reopened editor can resume reconciliation. */
export async function GET(request: Request) {
  try {
    const input = recoverableRenderQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return NextResponse.json(
        { error: "No tienes permisos para consultar renders de HyperFrames." },
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

    const service = new HyperframesRenderRecoveryService(getServiceRoleClient());
    const result = await service.findLatestForComposition({
      compositionId: input.compositionId,
      organizationId: tenant.organizationId,
    });
    return NextResponse.json(
      { success: true, data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Identificador de composición inválido." },
        { status: 400 },
      );
    }
    console.error("[API /production/hyperframes/renders GET] Unexpected error:", {
      ...getErrorDetails(error),
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Error interno al recuperar el render pendiente." },
      { status: 500 },
    );
  }
}

/** Submits an approved internal revision; it never accepts arbitrary HTML or ZIPs. */
export async function POST(request: Request) {
  try {
    const input = renderRequestSchema.parse(await request.json().catch(() => ({})));
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    if (!(await canReviewContent(authenticatedUser.userId))) {
      return NextResponse.json(
        { error: "No tienes permisos para enviar renders de HyperFrames." },
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

    const admin = getServiceRoleClient();
    const hyperframesAuth = await getHyperframesClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const service = new HyperframesRenderSubmissionService(admin, hyperframesAuth.client);
    const result = await service.submit({
      ...input,
      createdBy: authenticatedUser.userId,
      organizationId: tenant.organizationId,
    });
    return NextResponse.json({ success: true, data: result }, { status: result.reused ? 200 : 202 });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Payload inválido para renderizar el video." },
        { status: 400 },
      );
    }
    if (error instanceof HyperframesRenderSubmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HyperframesCredentialResolverError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof HyperframesCloudApiError) {
      return NextResponse.json(
        { error: error.message, providerCode: error.code || null },
        { status: error.status === 429 ? 429 : 502 },
      );
    }

    console.error("[API /production/hyperframes/renders] Unexpected error:", {
      ...getErrorDetails(error),
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Error interno al enviar el render de video." },
      { status: 500 },
    );
  }
}
