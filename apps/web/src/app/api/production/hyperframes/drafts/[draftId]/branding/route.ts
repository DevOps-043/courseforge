import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { buildAssemblyBrandingSnapshot, reconcileAssemblyBrandingDocument, resolveAssemblyBranding } from "@/domains/production/composition-editor/composition-branding.service";
import { applyAndAppendCompositionDocumentPatches, CompositionDocumentError, getCurrentCompositionDocument } from "@/domains/production/composition-editor/composition-document.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequestOptional } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_BRANDING_REQUEST_BYTES = 4 * 1024;

interface RouteContext { params: Promise<{ draftId: string }>; }
const outroSelectionSchema = z.object({ outroAssetId: z.string().uuid().nullable() }).strict();

/** Reports only whether approved branding is available; Storage identity stays server-side. */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.branding", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const [branding, { data: outros, error: outrosError }, { data: selected, error: selectedError }] = await Promise.all([
      resolveAssemblyBranding({
        draftId,
        organizationId: authorization.organizationId,
        supabase: authorization.admin,
      }),
      authorization.admin.from("organization_assembly_assets").select("id, name, duration_milliseconds").eq("organization_id", authorization.organizationId).eq("kind", "OUTRO").eq("status", "APPROVED").order("created_at", { ascending: false }),
      authorization.admin.from("video_composition_draft_branding").select("outro_asset_id").eq("draft_id", draftId).eq("organization_id", authorization.organizationId).maybeSingle(),
    ]);
    if (outrosError || selectedError) throw outrosError || selectedError;
    return apiSuccessResponse({
      data: {
        hasIntro: Boolean(branding.intro),
        hasOutro: Boolean(branding.outro),
        outros: outros || [],
        selectedOutroAssetId: selected?.outro_asset_id || null,
      },
    }, { headers: { "Cache-Control": "private, no-store" }, requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de borrador inválido.", requestId, status: 400 });
    logger.error("production.hyperframes.draft.branding_read_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo consultar la configuración de intro y outro.", requestId, retryable: true, status: 500 });
  }
}

/** Resolves and freezes approved organization branding for a single draft. */
export async function POST(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.branding", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const draftId = z.string().uuid().parse((await context.params).draftId);
    const parsed = await parseJsonRequestOptional(request, outroSelectionSchema, MAX_HYPERFRAMES_BRANDING_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "La selección de outro no es válida.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const requestedSelection = parsed.data;
    if (requestedSelection) {
      if (requestedSelection.outroAssetId) {
        const { data: outro } = await authorization.admin.from("organization_assembly_assets").select("id").eq("id", requestedSelection.outroAssetId).eq("organization_id", authorization.organizationId).eq("kind", "OUTRO").eq("status", "APPROVED").maybeSingle();
        if (!outro) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "El outro seleccionado no pertenece a esta empresa o no está aprobado.", requestId, status: 400 });
      }
      const { error: selectionError } = await authorization.admin.from("video_composition_draft_branding").upsert({
        draft_id: draftId,
        organization_id: authorization.organizationId,
        intro_asset_id: null,
        intro_source: "ASSEMBLY_OVERRIDE",
        outro_asset_id: requestedSelection.outroAssetId,
        resolved_at: new Date().toISOString(),
        resolved_by: authorization.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "draft_id" });
      if (selectionError) throw selectionError;
    }
    const branding = await resolveAssemblyBranding({
      draftId,
      organizationId: authorization.organizationId,
      supabase: authorization.admin,
    });
    const { error } = await authorization.admin
      .from("video_composition_draft_branding")
      .upsert({
        draft_id: draftId,
        organization_id: authorization.organizationId,
        intro_asset_id: branding.intro?.id || null,
        intro_snapshot: branding.intro ? buildAssemblyBrandingSnapshot(branding.intro) : null,
        intro_source: branding.introSource,
        outro_asset_id: branding.outro?.id || null,
        outro_snapshot: branding.outro ? buildAssemblyBrandingSnapshot(branding.outro) : null,
        resolved_at: new Date().toISOString(),
        resolved_by: authorization.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "draft_id" });
    if (error) throw error;
    const current = await getCurrentCompositionDocument({ draftId, organizationId: authorization.organizationId, supabase: authorization.admin });
    const document = reconcileAssemblyBrandingDocument(current.document, branding);
    const updated = await applyAndAppendCompositionDocumentPatches({
      auditSource: "SYSTEM",
      draftId,
      expectedDocumentHash: current.documentHash,
      organizationId: authorization.organizationId,
      patch: {
        operations: [{ document, type: "document.reconcile" }],
        source: "USER",
        summary: "Actualizó el outro seleccionado para este video.",
      },
      supabase: authorization.admin,
      userId: authorization.userId,
    });
    return apiSuccessResponse({ data: { branding, ...updated } }, { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de borrador inválido.", requestId, status: 400 });
    if (error instanceof CompositionDocumentError) return apiErrorResponse({ code: error.status === 404 ? API_ERROR_CODE.resourceNotFound : error.status === 409 ? API_ERROR_CODE.conflict : API_ERROR_CODE.invalidRequest, message: error.message, requestId, status: error.status });
    logger.error("production.hyperframes.draft.branding_update_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo resolver la configuración de intro y outro.", requestId, retryable: true, status: 500 });
  }
}

async function authorize(requestId: string) {
  const client = await createClient();
  const user = await getAuthenticatedUser(client);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (!(await canReviewContent(user.userId, tenant))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null, userId: user.userId };
}
