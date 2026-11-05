import { resolveActiveTenantContext } from "../../lib/server/tenant-context";
import { getAuthorizedArtifactAdminForTenant, getServiceRoleClient } from "../../lib/server/artifact-action-auth";
import { CourseSourceError } from "./course-source-error";

export async function requireCourseSourceAccess(artifactId?: string) {
  const tenant = await resolveActiveTenantContext();
  if (!tenant) throw new CourseSourceError(401, "Inicia sesión en una organización autorizada.");
  if (!tenant.platformRole || !["ADMIN", "SUPERADMIN", "ARQUITECTO", "CONSTRUCTOR"].includes(tenant.platformRole)) {
    throw new CourseSourceError(403, "No tienes permisos para gestionar fuentes del curso.");
  }
  if (artifactId) {
    const authorized = await getAuthorizedArtifactAdminForTenant(artifactId, tenant);
    if (!authorized) throw new CourseSourceError(404, "Curso no encontrado para esta organización.");
    return { tenant, admin: authorized.admin };
  }
  return { tenant, admin: getServiceRoleClient() };
}
