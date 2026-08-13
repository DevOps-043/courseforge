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
import { createClient } from "@/utils/supabase/server";

interface RouteContext {
  params: Promise<{ requestId: string }>;
}

const requestIdSchema = z.string().uuid();

/**
 * Explicit polling endpoint. The browser/admin scheduler calls this endpoint;
 * HeyGen is never given a callback URL and cannot call Courseforge directly.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { requestId: rawRequestId } = await context.params;
    const requestId = requestIdSchema.parse(rawRequestId);
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

    const admin = getServiceRoleClient();
    const hyperframesAuth = await getHyperframesClientForOrganization({
      allowGlobalFallback: false,
      organizationId: tenant.organizationId,
      supabase: admin,
    });
    const service = new HyperframesRenderPollingService(
      admin,
      hyperframesAuth.client,
    );
    const result = await service.poll({
      organizationId: tenant.organizationId,
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
      message: getErrorMessage(error),
    });
    return NextResponse.json(
      { error: "Error interno al consultar el render de video." },
      { status: 500 },
    );
  }
}
