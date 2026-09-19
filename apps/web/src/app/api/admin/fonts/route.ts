import { createHash } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  MAX_ORGANIZATION_FONT_BYTES,
  isAllowedGoogleFontCssUrl,
  resolveOrganizationFontUpload,
  validateOrganizationFontBinary,
} from "@/domains/production/fonts/organization-font-upload-policy.service";
import { ORGANIZATION_FONT_STORAGE_BUCKET, ORGANIZATION_FONT_TABLE } from "@/domains/production/fonts/organization-font.types";
import { API_ERROR_CODE, parseJsonRequest } from "@/lib/server/api-contract";
import { apiErrorResponse, apiSuccessResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";

const MAX_GOOGLE_FONT_REQUEST_BYTES = 8 * 1024;
const MAX_FONT_MULTIPART_REQUEST_BYTES = MAX_ORGANIZATION_FONT_BYTES + 1024 * 1024;
const FONT_SELECT = "id, family, source, css_url, storage_bucket, storage_path, checksum_sha256, mime_type, file_size_bytes, status, created_at";

const googleFontSchema = z.object({
  family: z.string().trim().regex(/^[a-zA-Z0-9 ._-]+$/).min(1).max(120),
  source: z.literal("google"),
  cssUrl: z.string().url().max(2_000).refine(isAllowedGoogleFontCssUrl, "URL de Google Fonts inválida"),
}).strict();

async function authorize(requestId: string, requireAdmin: boolean) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 }) } as const;
  const tenant = await resolveActiveTenantContext();
  if (!tenant?.organizationId) return { response: apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no válida o no autorizada.", requestId, status: 403 }) } as const;
  if (requireAdmin && tenant.platformRole !== "ADMIN" && tenant.platformRole !== "SUPERADMIN") {
    return { response: apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: "Se requiere acceso de administrador para gestionar fuentes.", requestId, status: 403 }) } as const;
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, response: null, userId: user.userId } as const;
}

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const context = await authorize(requestId, false);
  if (context.response) return context.response;
  const { data, error } = await context.admin.from(ORGANIZATION_FONT_TABLE).select(FONT_SELECT)
    .eq("organization_id", context.organizationId).order("created_at", { ascending: false });
  if (error) {
    createOperationalLogger("admin.fonts", { correlationId: requestId }).error("fonts.list_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudieron cargar las fuentes.", requestId, retryable: true, status: 500 });
  }
  const fonts = await Promise.all((data || []).map(async (font) => {
    let cssUrl = font.css_url || undefined;
    if (!cssUrl && font.storage_path) {
      const bucket = font.storage_bucket || "production-assets";
      const { data: signed, error: signedError } = await context.admin.storage.from(bucket).createSignedUrl(font.storage_path, 15 * 60);
      if (!signedError) cssUrl = signed.signedUrl;
    }
    return {
      ...font,
      cssUrl,
      renderEligible: font.source === "uploaded" && font.status === "READY"
        && typeof font.checksum_sha256 === "string" && typeof font.storage_path === "string",
    };
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
  const logger = createOperationalLogger("admin.fonts", { correlationId: requestId });
  const context = await authorize(requestId, true);
  if (context.response) return context.response;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const parsed = await parseJsonRequest(request, googleFontSchema, MAX_GOOGLE_FONT_REQUEST_BYTES);
    if (!parsed.success) return apiErrorResponse({
      code: parsed.reason === "too_large" ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
      message: parsed.reason === "too_large" ? "La solicitud excede el tamaño permitido." : "Datos de fuente Google inválidos.",
      requestId,
      status: parsed.reason === "too_large" ? 413 : 400,
    });
    const { data: existing, error: existingError } = await context.admin.from(ORGANIZATION_FONT_TABLE).select(FONT_SELECT)
      .eq("organization_id", context.organizationId).eq("family", parsed.data.family).eq("source", "google")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingError) return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo verificar la fuente existente.", requestId, retryable: true, status: 500 });
    if (existing) return apiSuccessResponse({ created: false, font: { ...existing, cssUrl: existing.css_url, renderEligible: false } }, { requestId });
    const { data, error } = await context.admin.from(ORGANIZATION_FONT_TABLE).insert({
      organization_id: context.organizationId, created_by: context.userId, family: parsed.data.family,
      source: "google", css_url: parsed.data.cssUrl, status: "READY",
    }).select(FONT_SELECT).single();
    if (error) return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo guardar la fuente.", requestId, retryable: true, status: 500 });
    return apiSuccessResponse({ created: true, font: { ...data, cssUrl: data.css_url, renderEligible: false } }, { requestId, status: 201 });
  }

  if (!contentType.includes("multipart/form-data")) {
    return apiErrorResponse({ code: API_ERROR_CODE.unsupportedMediaType, message: "Content-Type no soportado.", requestId, status: 415 });
  }
  const declaredBytes = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_FONT_MULTIPART_REQUEST_BYTES) {
    return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: "La solicitud excede el tamaño permitido.", requestId, status: 413 });
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Formulario multipart inválido.", requestId, status: 400 }); }
  const family = String(form.get("family") || "").trim();
  const file = form.get("file");
  if (!/^[a-zA-Z0-9 ._-]+$/.test(family) || family.length > 120 || !(file instanceof File)) {
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Indica un nombre de familia y una fuente válida.", requestId, status: 400 });
  }

  let upload: ReturnType<typeof resolveOrganizationFontUpload>;
  let bytes: Uint8Array;
  let embedding: ReturnType<typeof validateOrganizationFontBinary>["embedding"];
  try {
    upload = resolveOrganizationFontUpload(file);
    bytes = new Uint8Array(await file.arrayBuffer());
    embedding = validateOrganizationFontBinary(bytes, upload.extension).embedding;
  } catch (error) {
    logger.warn("fonts.upload_rejected", { reason: error instanceof Error ? error.message : "unknown" });
    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: error instanceof Error ? error.message : "Fuente no válida.", requestId, status: 400 });
  }

  try {
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const { data: existing, error: existingError } = await context.admin.from(ORGANIZATION_FONT_TABLE).select(FONT_SELECT)
      .eq("organization_id", context.organizationId).eq("checksum_sha256", checksum).limit(1).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (!existing.storage_path) throw new Error("La fuente existente no tiene una ruta de almacenamiento válida.");
      const { data: signed, error: signedError } = await context.admin.storage
        .from(existing.storage_bucket || ORGANIZATION_FONT_STORAGE_BUCKET)
        .createSignedUrl(existing.storage_path, 15 * 60);
      if (signedError || !signed?.signedUrl) throw signedError || new Error("No se pudo firmar la fuente existente.");
      const renderEligible = existing.source === "uploaded" && existing.status === "READY"
        && typeof existing.checksum_sha256 === "string";
      return apiSuccessResponse({ created: false, font: { ...existing, cssUrl: signed.signedUrl, renderEligible } }, { requestId });
    }
    const status = embedding === "ALLOWED" ? "READY" : "LEGACY";
    const storagePath = `${context.organizationId}/${checksum}.${upload.extension}`;
    const { error: uploadError } = await context.admin.storage.from(ORGANIZATION_FONT_STORAGE_BUCKET).upload(storagePath, bytes, { contentType: upload.contentType, upsert: true });
    if (uploadError) throw uploadError;
    const { data, error } = await context.admin.from(ORGANIZATION_FONT_TABLE).insert({
      checksum_sha256: checksum, created_by: context.userId, family, file_size_bytes: bytes.byteLength,
      mime_type: upload.contentType, organization_id: context.organizationId, source: "uploaded", status,
      storage_bucket: ORGANIZATION_FONT_STORAGE_BUCKET, storage_path: storagePath,
    }).select(FONT_SELECT).single();
    if (error) throw error;
    const { data: signed, error: signedError } = await context.admin.storage
      .from(ORGANIZATION_FONT_STORAGE_BUCKET)
      .createSignedUrl(storagePath, 15 * 60);
    if (signedError || !signed?.signedUrl) throw signedError || new Error("No se pudo firmar la fuente subida.");
    return apiSuccessResponse({
      created: true,
      font: { ...data, cssUrl: signed.signedUrl, renderEligible: status === "READY" },
    }, { requestId, status: 201 });
  } catch (error) {
    logger.error("fonts.upload_failed", error);
    return apiErrorResponse({
      code: API_ERROR_CODE.internalError,
      message: "No se pudo guardar la fuente.",
      requestId,
      retryable: true,
      status: 500,
    });
  }
}
