import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { MAX_ORGANIZATION_FONT_BYTES, resolveOrganizationFontUpload } from "@/domains/production/slides/fonts/font-upload-policy.service";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_GOOGLE_FONT_REQUEST_BYTES = 8 * 1024;
const MAX_FONT_MULTIPART_REQUEST_BYTES = MAX_ORGANIZATION_FONT_BYTES + 1024 * 1024;

const googleFontSchema = z.object({
  family: z.string().trim().regex(/^[a-zA-Z0-9 ._-]+$/).min(1).max(120),
  source: z.literal("google"),
  cssUrl: z.string().url().max(2000).refine((url) => url.startsWith("https://fonts.googleapis.com/"), "URL de Google Fonts inválida"),
}).strict();

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  const tenant = await resolveActiveTenantContext();
  if (!user || !tenant?.organizationId) return null;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const context = await authorize();
  if (!context) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
  const { data, error } = await context.admin
    .from("organization_slide_fonts")
    .select("id, family, source, css_url, storage_path, created_at")
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false });
  if (error) {
    createOperationalLogger("admin.slides.fonts", { correlationId: requestId }).error("slides.fonts.list_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron cargar las fuentes.", requestId, retryable: true, status: 500 });
  }
  const fonts = (data || []).map((font) => ({
    ...font,
    cssUrl: font.css_url || (font.storage_path ? context.admin.storage.from("production-assets").getPublicUrl(font.storage_path).data.publicUrl : undefined),
  }));
  const fontsByIdentity = new Map<string, (typeof fonts)[number]>();
  for (const font of fonts) {
    const identity = `${font.source}:${font.family.trim().toLowerCase()}`;
    if (!fontsByIdentity.has(identity)) fontsByIdentity.set(identity, font);
  }
  return apiSuccessResponse({ fonts: [...fontsByIdentity.values()] }, { requestId });
}

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("admin.slides.fonts", { correlationId: requestId });
  const context = await authorize();
  if (!context) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const parsed = await parseJsonRequest(request, googleFontSchema, MAX_GOOGLE_FONT_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({
      code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
      message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Datos de fuente Google inválidos.",
      requestId,
      status: parsed.reason === "too_large" ? 413 : 400,
    });
    const { data: existing, error: existingError } = await context.admin.from("organization_slide_fonts")
      .select("id, family, source, css_url, storage_path, created_at")
      .eq("organization_id", context.organizationId)
      .eq("family", parsed.data.family)
      .eq("source", "google")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo verificar la fuente existente.", requestId, retryable: true, status: 500 });
    if (existing) return apiSuccessResponse({ created: false, font: { ...existing, cssUrl: existing.css_url } }, { requestId });
    const { data, error } = await context.admin.from("organization_slide_fonts").insert({
      organization_id: context.organizationId, created_by: context.userId, family: parsed.data.family, source: "google", css_url: parsed.data.cssUrl,
    }).select("id, family, source, css_url, storage_path, created_at").single();
    if (error) return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar la fuente.", requestId, retryable: true, status: 500 });
    return apiSuccessResponse({ created: true, font: { ...data, cssUrl: data.css_url } }, { requestId, status: 201 });
  }

  if (!contentType.includes("multipart/form-data")) {
    return apiErrorResponse({ code: API_ERROR_CODE.unsupportedMediaType, message: "Content-Type no soportado.", requestId, status: 415 });
  }
  const declaredBytes = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_FONT_MULTIPART_REQUEST_BYTES) {
    return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: "La solicitud excede el tamaño permitido.", requestId, status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Formulario multipart inválido.", requestId, status: 400 });
  }
  const family = String(form.get("family") || "").trim();
  const file = form.get("file");
  if (!/^[a-zA-Z0-9 ._-]+$/.test(family) || family.length > 120 || !(file instanceof File)) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Indica un nombre de familia y una fuente válida.", requestId, status: 400 });
  }
  let upload;
  try {
    upload = resolveOrganizationFontUpload(file);
  } catch (error) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error instanceof Error ? error.message : "Fuente no válida.", requestId, status: 400 });
  }
  const { extension, contentType: canonicalContentType } = upload;
  const { data: existing, error: existingError } = await context.admin.from("organization_slide_fonts")
    .select("id, family, source, css_url, storage_path, created_at")
    .eq("organization_id", context.organizationId)
    .eq("family", family)
    .eq("source", "uploaded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo verificar la fuente existente.", requestId, retryable: true, status: 500 });
  if (existing) {
    const cssUrl = existing.css_url || (existing.storage_path ? context.admin.storage.from("production-assets").getPublicUrl(existing.storage_path).data.publicUrl : undefined);
    return apiSuccessResponse({ created: false, font: { ...existing, cssUrl } }, { requestId });
  }
  const path = `organization-fonts/${context.organizationId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await context.admin.storage.from("production-assets").upload(path, file, { contentType: canonicalContentType, upsert: false });
  if (uploadError) return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo cargar el archivo de fuente.", requestId, retryable: true, status: 500 });
  const { data, error } = await context.admin.from("organization_slide_fonts").insert({
    organization_id: context.organizationId, created_by: context.userId, family, source: "uploaded", storage_path: path,
  }).select("id, family, source, css_url, storage_path, created_at").single();
  if (error) {
    const { error: cleanupError } = await context.admin.storage.from("production-assets").remove([path]);
    if (cleanupError) logger.error("slides.fonts.cleanup_failed", cleanupError, { storagePath: path });
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "La fuente se cargó, pero no se pudo registrar.", requestId, retryable: true, status: 500 });
  }
  const cssUrl = context.admin.storage.from("production-assets").getPublicUrl(path).data.publicUrl;
  return apiSuccessResponse({ created: true, font: { ...data, cssUrl } }, { requestId, status: 201 });
}
