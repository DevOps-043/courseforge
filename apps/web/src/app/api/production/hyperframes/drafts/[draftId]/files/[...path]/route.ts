import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { assertSafeDraftRelativePath, contentVersion, HyperframesDraftError } from "@/domains/production/hyperframes/hyperframes-draft.service";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_HYPERFRAMES_DRAFT_FILE_REQUEST_BYTES = 1_100_000;

interface RouteContext { params: Promise<{ draftId: string; path: string[] }>; }
const writeSchema = z.object({ content: z.string().max(1_000_000) }).strict();

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.file", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const file = await getDraftFile({ ...authorization, ...await readParams(context) });
    const { data, error } = await authorization.admin.storage
      .from(file.storage_bucket)
      .download(toBucketRelativePath(file.storage_bucket, file.storage_path));
    if (error) throw error;
    return apiSuccessResponse({ content: await data.text(), path: file.relative_path, version: file.content_version }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.draft.file_read_failed", error);
    return respondFileError(error, "No se pudo leer el archivo de edición.", requestId);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("production.hyperframes.draft.file", { correlationId: requestId });
  try {
    const authorization = await authorize(requestId);
    if (authorization.response) return authorization.response;
    const params = await readParams(context);
    const file = await getDraftFile({ ...authorization, ...params });
    const expectedVersion = request.headers.get("if-match")?.replaceAll('"', "");
    if (!expectedVersion || expectedVersion !== file.content_version) {
      return apiErrorResponse({ code: API_ERROR_CODE.conflict, extensions: { version: file.content_version }, message: "El archivo cambió en otra sesión. Recarga antes de guardar.", requestId, retryable: true, status: 409 });
    }
    const parsed = await parseJsonRequest(request, writeSchema, MAX_HYPERFRAMES_DRAFT_FILE_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({ code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest, message: parsed.reason === "too_large" ? "El archivo excede el tamaño permitido." : "El contenido del archivo no es válido.", requestId, status: parsed.reason === "too_large" ? 413 : 400 });
    const input = parsed.data;
    const nextVersion = contentVersion(input.content);
    const { error: uploadError } = await authorization.admin.storage
      .from(file.storage_bucket)
      .update(toBucketRelativePath(file.storage_bucket, file.storage_path), input.content, { contentType: file.content_type });
    if (uploadError) throw uploadError;
    const now = new Date().toISOString();
    const { error: updateError } = await authorization.admin
      .from("video_composition_draft_files")
      .update({ checksum: nextVersion, content_version: nextVersion, file_size_bytes: Buffer.byteLength(input.content, "utf8"), updated_at: now })
      .eq("id", file.id)
      .eq("content_version", expectedVersion);
    if (updateError) throw updateError;
    return apiSuccessResponse({ path: file.relative_path, version: nextVersion }, { requestId });
  } catch (error) {
    logger.error("production.hyperframes.draft.file_write_failed", error);
    return respondFileError(error, "No se pudo guardar el archivo de edición.", requestId);
  }
}

async function readParams(context: RouteContext) {
  const { draftId, path } = await context.params;
  return { draftId: z.string().uuid().parse(draftId), relativePath: assertSafeDraftRelativePath(path.join("/")) };
}

async function getDraftFile(params: { admin: ReturnType<typeof getServiceRoleClient>; draftId: string; organizationId: string; relativePath: string }) {
  const { data, error } = await params.admin
    .from("video_composition_draft_files")
    .select("id, relative_path, storage_bucket, storage_path, content_type, content_version")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("relative_path", params.relativePath)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HyperframesDraftError("Archivo de edición no encontrado.", 404);
  return data;
}

async function authorize(requestId: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  if (!(await canReviewContent(user.userId))) return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "No tienes permisos para editar videos.", requestId, status: 403 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null };
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new HyperframesDraftError("Ruta de archivo insegura.");
  return path;
}

function respondFileError(error: unknown, fallback: string, requestId: string) {
  if (error instanceof z.ZodError || error instanceof HyperframesDraftError) {
    const status = error instanceof HyperframesDraftError ? error.status : 400;
    return apiErrorResponse({ code: status === 404 ? API_ERROR_CODE.resourceNotFound : API_ERROR_CODE.invalidRequest, message: error.message, requestId, status });
  }
  return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: fallback, requestId, retryable: true, status: 500 });
}
