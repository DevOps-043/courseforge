import { resolveActiveTenantContext } from "../../../lib/server/tenant-context";
import { getAuthorizedArtifactAdminForTenant, getServiceRoleClient } from "../../../lib/server/artifact-action-auth";
import { REVIEWER_ROLE_SET } from "../../../lib/pipeline-constants";

export class DeliveryAccessError extends Error {
  constructor(message: string, readonly status: 401 | 403 | 404) { super(message); this.name = "DeliveryAccessError"; }
}
export async function requireDeliveryAccess(artifactId?: string, review = false) {
  const tenant = await resolveActiveTenantContext();
  if (!tenant) throw new DeliveryAccessError("Inicia sesión en una organización autorizada.", 401);
  if (!tenant.platformRole || !["ADMIN", "ARQUITECTO", "CONSTRUCTOR", "SUPERADMIN"].includes(tenant.platformRole)) throw new DeliveryAccessError("No tienes acceso a este curso.", 403);
  if (review && !REVIEWER_ROLE_SET.has(tenant.platformRole)) throw new DeliveryAccessError("Solo Arquitectos y Admins pueden aprobar o configurar la generación.", 403);
  if (artifactId) {
    const authorized = await getAuthorizedArtifactAdminForTenant(artifactId, tenant);
    if (!authorized) throw new DeliveryAccessError("Curso no encontrado para esta organización.", 404);
    return { tenant, admin: authorized.admin };
  }
  return { tenant, admin: getServiceRoleClient() };
}
