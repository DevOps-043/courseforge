import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, TenantContextLookupError } from "@/lib/server/tenant-context";
import {
  applyAndAppendCompositionDocumentPatches,
  CompositionDocumentConflictError,
  CompositionDocumentError,
  CompositionDocumentPersistenceError,
  getCurrentCompositionDocument,
  listCompositionDocumentHistory,
} from "@/domains/production/composition-editor/composition-document.service";
import { compositionEditorPatchRequestSchema } from "@/domains/production/composition-editor/editor-patch.types";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Returns the native editor document; no source HTML or Storage path is exposed. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { draftId } = await context.params;
    const parsedDraftId = z.string().uuid().parse(draftId);
    if (new URL(request.url).searchParams.get("history") === "1") {
      const data = await listCompositionDocumentHistory({
        draftId: parsedDraftId,
        organizationId: authorization.organizationId,
        supabase: authorization.admin,
      });
      return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const data = await getCurrentCompositionDocument({
      draftId: parsedDraftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { ETag: `"${data.documentHash}"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return tenantUnavailableResponse(error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    if (error instanceof CompositionDocumentPersistenceError) return compositionErrorResponse(error);
    if (error instanceof CompositionDocumentError) return NextResponse.json({ error: error.message, code: "COMPOSITION_DOCUMENT_ERROR", retryable: false }, { status: error.status });
    if (isTransientStorageError(error)) return storageUnavailableResponse();
    console.error("[API /production/hyperframes/drafts/:id/document] Unexpected error:", serializeError(error));
    return NextResponse.json({ error: "No se pudo cargar el documento de composición." }, { status: 500 });
  }
}

/** Appends one validated editor version. The If-Match hash prevents silent overwrites. */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { draftId } = await context.params;
    const expectedDocumentHash = request.headers.get("if-match")?.replaceAll('"', "").trim();
    if (!expectedDocumentHash || !/^[a-f0-9]{64}$/i.test(expectedDocumentHash)) {
      return NextResponse.json({ error: "Falta la versión actual del documento (If-Match)." }, { status: 428 });
    }
    const body = compositionEditorPatchRequestSchema.parse(await request.json());
    const persistenceSignal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    const data = await applyAndAppendCompositionDocumentPatches({
      draftId: z.string().uuid().parse(draftId),
      expectedDocumentHash: expectedDocumentHash.toLowerCase(),
      organizationId: authorization.organizationId,
      patch: body,
      signal: persistenceSignal,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { ETag: `"${data.documentHash}"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof TenantContextLookupError) return tenantUnavailableResponse(error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: error.issues[0]?.message || "La edición solicitada no es válida.",
        code: "COMPOSITION_PATCH_INVALID",
        retryable: false,
      }, { status: 400 });
    }
    if (error instanceof CompositionDocumentConflictError) {
      return NextResponse.json({ error: error.message, code: "COMPOSITION_VERSION_CONFLICT", data: error.current, retryable: true }, { status: error.status });
    }
    if (error instanceof CompositionDocumentPersistenceError) return compositionErrorResponse(error);
    if (error instanceof CompositionDocumentError) return NextResponse.json({ error: error.message, code: "COMPOSITION_DOCUMENT_ERROR", retryable: false }, { status: error.status });
    if (isTransientStorageError(error)) return storageUnavailableResponse();
    console.error("[API /production/hyperframes/drafts/:id/document] Unexpected update error:", serializeError(error));
    return NextResponse.json({ error: "No se pudo guardar la edición de la composición." }, { status: 500 });
  }
}

function compositionErrorResponse(error: CompositionDocumentPersistenceError) {
  return NextResponse.json({
    error: error.message,
    code: error.code,
    retryable: error.retryable,
    ...(error.diagnosticId ? { diagnosticId: error.diagnosticId } : {}),
  }, { status: error.status });
}

function tenantUnavailableResponse(error: TenantContextLookupError) {
  return NextResponse.json({ error: error.message, code: error.code, retryable: true }, { status: 503 });
}

function storageUnavailableResponse() {
  return NextResponse.json({
    error: "El almacenamiento está ocupado y no respondió a tiempo. Tus cambios no se descartaron; vuelve a intentar.",
    code: "COMPOSITION_STORAGE_UNAVAILABLE",
    retryable: true,
  }, { status: 503 });
}

function isTransientStorageError(error: unknown) {
  const serialized = serializeError(error);
  return serialized.code === "PGRST003"
    || /timed out acquiring connection|connection pool|pool timeout|fetch failed/i.test(serialized.message);
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

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  if (!(await canReviewContent(user.userId, tenant))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
