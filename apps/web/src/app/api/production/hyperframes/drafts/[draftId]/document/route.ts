import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  applyAndAppendCompositionDocumentPatches,
  CompositionDocumentConflictError,
  CompositionDocumentError,
  CompositionDocumentPersistenceError,
  getCurrentCompositionDocument,
} from "@/domains/production/composition-editor/composition-document.service";
import { compositionEditorPatchRequestSchema } from "@/domains/production/composition-editor/editor-patch.types";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string }>; }

/** Returns the native editor document; no source HTML or Storage path is exposed. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { draftId } = await context.params;
    const data = await getCurrentCompositionDocument({
      draftId: z.string().uuid().parse(draftId),
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { ETag: `"${data.documentHash}"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de borrador inválido." }, { status: 400 });
    if (error instanceof CompositionDocumentPersistenceError) return compositionErrorResponse(error);
    if (error instanceof CompositionDocumentError) return NextResponse.json({ error: error.message, code: "COMPOSITION_DOCUMENT_ERROR", retryable: false }, { status: error.status });
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
      return NextResponse.json({ error: "Falta la versiÃ³n actual del documento (If-Match)." }, { status: 428 });
    }
    const body = compositionEditorPatchRequestSchema.parse(await request.json());
    const data = await applyAndAppendCompositionDocumentPatches({
      draftId: z.string().uuid().parse(draftId),
      expectedDocumentHash: expectedDocumentHash.toLowerCase(),
      organizationId: authorization.organizationId,
      patch: body,
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return NextResponse.json({ success: true, data }, {
      headers: { ETag: `"${data.documentHash}"`, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La ediciÃ³n solicitada no es vÃ¡lida." }, { status: 400 });
    if (error instanceof CompositionDocumentConflictError) {
      return NextResponse.json({ error: error.message, code: "COMPOSITION_VERSION_CONFLICT", data: error.current, retryable: true }, { status: error.status });
    }
    if (error instanceof CompositionDocumentPersistenceError) return compositionErrorResponse(error);
    if (error instanceof CompositionDocumentError) return NextResponse.json({ error: error.message, code: "COMPOSITION_DOCUMENT_ERROR", retryable: false }, { status: error.status });
    console.error("[API /production/hyperframes/drafts/:id/document] Unexpected update error:", serializeError(error));
    return NextResponse.json({ error: "No se pudo guardar la ediciÃ³n de la composiciÃ³n." }, { status: 500 });
  }
}

function compositionErrorResponse(error: CompositionDocumentPersistenceError) {
  return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
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
  if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
