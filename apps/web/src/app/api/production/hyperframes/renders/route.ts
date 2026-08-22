import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorDetails, getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { runHyperframesRenderBackground } from "@/domains/production/hyperframes/hyperframes-render-background.service";
import {
  HyperframesRenderSubmissionError,
  HyperframesRenderSubmissionService,
} from "@/domains/production/hyperframes/hyperframes-render-submission.service";
import { HyperframesRenderRecoveryService } from "@/domains/production/hyperframes/hyperframes-render-recovery.service";
import {
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "@/domains/production/hyperframes/hyperframes-request-validation";
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

/** Returns durable provider work so a reopened editor can resume reconciliation. */
export async function GET(request: Request) {
  try {
    const compositionId = validateHyperframesCompositionId(
      new URL(request.url).searchParams.get("compositionId"),
    );
    if (!compositionId.success) {
      return NextResponse.json(
        { error: "Identificador de composición inválido.", code: "COMPOSITION_ID_INVALID" },
        { status: 400 },
      );
    }
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
      compositionId: compositionId.data,
      organizationId: tenant.organizationId,
    });
    return NextResponse.json(
      { success: true, data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      console.error("[API /production/hyperframes/renders GET] Recovery data validation failed:", {
        issues: summarizeHyperframesValidationIssues(error),
      });
      return NextResponse.json(
        {
          error: "Los datos del render pendiente no cumplen el formato requerido.",
          code: "RENDER_RECOVERY_DATA_INVALID",
        },
        { status: 422 },
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
    const service = new HyperframesRenderSubmissionService(admin);
    const result = await service.submit({
      ...input,
      createdBy: authenticatedUser.userId,
      deferProcessing: true,
      organizationId: tenant.organizationId,
    });
    if (!result.reused && !result.providerRenderId) {
      try {
        await callBackgroundFunctionJson(
          "hyperframes-render-background",
          { renderRequestId: result.renderRequestId },
          {
            fallbackError: "No se pudo iniciar el worker de render.",
            localHandlerLoader: async () => ({
              handler: async (event: { body: string }) => {
                const localPayload = JSON.parse(event.body) as { renderRequestId: string };
                await runHyperframesRenderBackground(localPayload.renderRequestId);
                return { statusCode: 200, body: JSON.stringify({ success: true }) };
              },
            }),
          },
        );
      } catch (dispatchError) {
        await service.failDispatch({
          error: dispatchError,
          organizationId: tenant.organizationId,
          requestId: result.renderRequestId,
        });
        throw new HyperframesRenderSubmissionError(
          "No se pudo iniciar el worker de render. Intenta nuevamente.",
          503,
        );
      }
    }
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
