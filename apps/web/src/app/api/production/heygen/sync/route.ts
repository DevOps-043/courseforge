import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenCatalogService } from "@/domains/production/providers/heygen/heygen-catalog.service";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import {
  getHeygenClientForOrganization,
  HeygenCredentialResolverError,
} from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { heygenSyncResponseSchema } from "@/domains/production/providers/heygen/heygen.validators";
import { createClient } from "@/utils/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const canReview = await canReviewContent(authenticatedUser.userId);
    if (!canReview) {
      return NextResponse.json(
        { error: "No tienes permisos para sincronizar HeyGen." },
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
    const service = new HeygenCatalogService({
      client: heygenAuth.client,
      supabase: admin,
    });
    const syncResult = await service.syncCatalog(tenant.organizationId);

    return NextResponse.json({
      success: true,
      data: heygenSyncResponseSchema.parse(syncResult),
    });
  } catch (error: unknown) {
    if (error instanceof HeygenApiError) {
      return NextResponse.json(
        { error: error.message },
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

    console.error("[API /production/heygen/sync] Unexpected error:", {
      message: getErrorMessage(error),
    });

    return NextResponse.json(
      { error: "Error interno del servidor al sincronizar HeyGen." },
      { status: 500 },
    );
  }
}

function buildRetryAfterHeaders(retryAfterSeconds?: number) {
  return retryAfterSeconds
    ? { "Retry-After": String(retryAfterSeconds) }
    : undefined;
}
