import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { createClient } from "@/utils/supabase/server";
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET } from "@/domains/production/media-storage.config";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const BROWSER_DELIVERY_TTL_SECONDS = 10 * 60;
const mediaQuerySchema = z.object({
  bucket: z.literal(HYPERFRAMES_PRIVATE_SOURCE_BUCKET),
  componentId: z.string().uuid(),
  path: z.string().min(1).max(1024).refine(isSafePath),
}).strict();

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("storage.media", { correlationId: requestId });
  try {
    const url = new URL(request.url);
    const parsedQuery = mediaQuerySchema.safeParse({
      bucket: url.searchParams.get("bucket") || "",
      componentId: url.searchParams.get("componentId") || "",
      path: url.searchParams.get("path") || "",
    });
    if (!parsedQuery.success) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Referencia de medio inválida.", requestId, status: 400 });
    }
    const { bucket, componentId, path } = parsedQuery.data;

    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
    if (!authorizedComponent) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Medio no encontrado para esta empresa.", requestId, status: 404 });
    }
    if (!pathBelongsToComponent(path, componentId)) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "El medio no pertenece al componente autorizado.", requestId, status: 403 });
    }

    const admin = getServiceRoleClient();
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, BROWSER_DELIVERY_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "No se pudo autorizar el medio.", requestId, status: 404 });
    }
    return NextResponse.redirect(data.signedUrl, {
      headers: { "Cache-Control": "private, no-store", "x-request-id": requestId },
      status: 307,
    });
  } catch (error: unknown) {
    logger.error("storage.media.authorization_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo autorizar el medio.", requestId, retryable: true, status: 500 });
  }
}

function pathBelongsToComponent(path: string, componentId: string) {
  const [folder, fileName, ...extra] = path.split("/");
  return extra.length === 0
    && new Set(["avatars", "broll", "music", "voices"]).has(folder || "")
    && Boolean(fileName?.startsWith(`${componentId}-`));
}

function isSafePath(path: string) {
  return Boolean(path)
    && !path.startsWith("/")
    && !path.includes("..")
    && !path.includes("\\")
    && path.split("/").every((segment) => segment && segment !== ".");
}
