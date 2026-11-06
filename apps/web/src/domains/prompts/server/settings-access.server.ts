import { z } from "zod";
import { getAuthenticatedUser, canReviewContent } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, type TenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { AuthIdentityLookupError } from "@/lib/server/auth-identity-error";
import { TenantContextLookupError } from "@/lib/server/tenant-context-error";
import { API_ERROR_CODE, type ApiErrorCode } from "@/lib/server/api-contract";
import { createOperationalLogger } from "@/lib/server/operational-logger";

type SettingsAccess = { authorized: true; userId: string; tenant: TenantContext }
  | { authorized: false; response: { success: false; error: string; errorCode: ApiErrorCode; retryable: boolean } };
const uuid = z.string().uuid();
const denied = (errorCode: ApiErrorCode, error: string, retryable = false): SettingsAccess => ({
  authorized: false, response: { success: false, error, errorCode, retryable },
});

export async function resolveSettingsAccess(mode: "READ" | "WRITE"): Promise<SettingsAccess> {
  try {
    const user = await getAuthenticatedUser(await createClient());
    if (!user) return denied(API_ERROR_CODE.authRequired, "Usuario no autenticado.");
    const tenant = await resolveActiveTenantContext();
    if (!tenant || tenant.userId !== user.userId || !uuid.safeParse(user.userId).success
      || !uuid.safeParse(tenant.organizationId).success) {
      return denied(API_ERROR_CODE.tenantForbidden, "Empresa no válida o no autorizada.");
    }
    if (mode === "WRITE" && !(await canReviewContent(user.userId, tenant))) {
      return denied(API_ERROR_CODE.roleForbidden, "No tienes permisos para modificar estos ajustes.");
    }
    return { authorized: true, userId: user.userId, tenant };
  } catch (error) {
    // Los errores desconocidos conservan el control de flujo del framework.
    if (!(error instanceof AuthIdentityLookupError) && !(error instanceof TenantContextLookupError)) throw error;
    try { createOperationalLogger("ajustes.autorizacion").warn("ajustes.autorizacion_no_disponible", { codigo: error.code }); }
    catch { /* La observabilidad no sustituye la respuesta segura. */ }
    return denied(API_ERROR_CODE.dependencyUnavailable, "No se pudo verificar temporalmente el acceso. Intenta de nuevo.", true);
  }
}
