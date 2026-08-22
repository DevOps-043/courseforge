import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import { initializeHyperframesDraft, HyperframesDraftError } from "@/domains/production/hyperframes/hyperframes-draft.service";
import {
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "@/domains/production/hyperframes/hyperframes-request-validation";
import { CompositionDocumentError } from "@/domains/production/composition-editor/composition-document.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ compositionId: string }>; }

/** Allocates and hydrates the mutable editor project without generating a render revision. */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { compositionId } = await context.params;
    const validatedCompositionId = validateHyperframesCompositionId(compositionId);
    if (!validatedCompositionId.success) {
      return NextResponse.json(
        { error: "Identificador de composición inválido.", code: "COMPOSITION_ID_INVALID" },
        { status: 400 },
      );
    }
    return initializeDraftResponse({
      admin: authorization.admin,
      compositionId: validatedCompositionId.data,
      organizationId: authorization.organizationId,
      userId: authorization.userId,
    });
  } catch (error) {
    if (error instanceof TenantContextLookupError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: true }, { status: 503 });
    }
    console.error("[API /production/hyperframes/compositions/:id/draft] Unexpected request error:", serializeError(error));
    return NextResponse.json({ error: "No se pudo preparar el proyecto de edición." }, { status: 500 });
  }
}

async function initializeDraftResponse(params: {
  admin: ReturnType<typeof getServiceRoleClient>;
  compositionId: string;
  organizationId: string;
  userId: string;
}) {
  try {
    const draft = await initializeHyperframesDraft({
      compositionId: params.compositionId,
      organizationId: params.organizationId,
      supabase: params.admin,
      userId: params.userId,
    });
    return NextResponse.json({ success: true, data: draft });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[API /production/hyperframes/compositions/:id/draft] Composition data validation failed:", {
        compositionId: params.compositionId,
        issues: summarizeHyperframesValidationIssues(error),
      });
      return NextResponse.json(
        {
          error: "Los datos de la composición no cumplen el formato requerido.",
          code: "COMPOSITION_DATA_INVALID",
        },
        { status: 422 },
      );
    }
    if (error instanceof HyperframesDraftError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof CompositionDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isTransientStorageError(error)) return NextResponse.json({ error: "El almacenamiento del editor está ocupado. Intenta preparar el proyecto nuevamente.", code: "COMPOSITION_STORAGE_UNAVAILABLE", retryable: true }, { status: 503 });
    console.error("[API /production/hyperframes/compositions/:id/draft] Unexpected error:", serializeError(error));
    return NextResponse.json({ error: "No se pudo preparar el proyecto de edición." }, { status: 500 });
  }
}

function serializeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return {
      code: typeof candidate.code === "string" ? candidate.code : null,
      details: typeof candidate.details === "string" ? candidate.details.slice(0, 500) : null,
      hint: typeof candidate.hint === "string" ? candidate.hint.slice(0, 300) : null,
      message: typeof candidate.message === "string" ? candidate.message.slice(0, 500) : getErrorMessage(error),
    };
  }
  return { message: getErrorMessage(error) };
}

function isTransientStorageError(error: unknown) {
  const serialized = serializeError(error);
  return serialized.code === "PGRST003"
    || /timed out acquiring connection|connection pool|pool timeout|fetch failed/i.test(serialized.message);
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  if (!(await canReviewContent(user.userId, tenant))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
