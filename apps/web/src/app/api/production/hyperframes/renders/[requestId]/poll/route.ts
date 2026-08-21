import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorDetails, getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  HyperframesCloudApiError,
} from "@/domains/production/hyperframes/hyperframes-cloud.client";
import {
  getHyperframesClientForOrganization,
  HyperframesCredentialResolverError,
} from "@/domains/production/hyperframes/hyperframes-credential-resolver.service";
import {
  HyperframesRenderPollingError,
  HyperframesRenderPollingService,
} from "@/domains/production/hyperframes/hyperframes-render-polling.service";
import { HyperframesRenderRecoveryService } from "@/domains/production/hyperframes/hyperframes-render-recovery.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

const requestIdSchema = z.string().uuid();

/** Returns tenant-scoped durable state without exposing the service-role key. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { requestId: rawRequestId } = await context.params;
    const requestId = requestIdSchema.parse(rawRequestId);
    const authorized = await resolveAuthorizedRenderContext();
    if (authorized.response) return authorized.response;

    const service = new HyperframesRenderRecoveryService(authorized.admin);
    const result = await service.findById({
      organizationId: authorized.organizationId,
      requestId,
    });
    if (!result) {
      return NextResponse.json(
        { error: "Render HyperFrames no encontrado para esta empresa." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: true, data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Identificador de render inválido." },
        { status: 400 },
      );
    }
    console.error("[API /production/hyperframes/renders/:requestId/poll GET] Unexpected error:", {
      ...getErrorDetails(error),
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Error interno al consultar el estado durable del render." },
      { status: 500 },
    );
  }
}

/**
 * Optional user-triggered reconciliation nudge. Webhooks and scheduled Edge
 * workers own durable tracking even when no browser is open.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { requestId: rawRequestId } = await context.params;
    const requestId = requestIdSchema.parse(rawRequestId);
    const authorized = await resolveAuthorizedRenderContext();
    if (authorized.response) return authorized.response;
    const hyperframesAuth = await getHyperframesClientForOrganization({
      allowGlobalFallback: false,
      organizationId: authorized.organizationId,
      supabase: authorized.admin,
    });
    const service = new HyperframesRenderPollingService(
      authorized.admin,
      hyperframesAuth.client,
    );
    const result = await service.poll({
      organizationId: authorized.organizationId,
      requestId,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Identificador de render inválido." },
        { status: 400 },
      );
    }
    if (error instanceof HyperframesRenderPollingError) {
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
        { error: "No se pudo consultar el render en la nube." },
        { status: error.status === 429 ? 429 : 502 },
      );
    }

    console.error("[API /production/hyperframes/renders/:requestId/poll] Unexpected error:", {
      ...getErrorDetails(error),
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Error interno al consultar el render de video." },
      { status: 500 },
    );
  }
}

async function resolveAuthorizedRenderContext() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: NextResponse.json({ error: "No autorizado." }, { status: 401 }),
    };
  }
  if (!(await canReviewContent(authenticatedUser.userId))) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: NextResponse.json(
        { error: "No tienes permisos para consultar renders de HyperFrames." },
        { status: 403 },
      ),
    };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: NextResponse.json(
        { error: "Empresa no válida o no autorizada." },
        { status: 403 },
      ),
    };
  }
  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    response: null,
  };
}
